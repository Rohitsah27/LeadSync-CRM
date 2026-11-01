import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as authService from '../services/auth.js';
import * as facebookService from '../services/facebook.js';
import { fetchHealth } from '../services/health.js';
import * as leadsService from '../services/leads.js';
import { apiError, renderAt, session } from '../test/harness.jsx';

vi.mock('../services/auth.js');
vi.mock('../services/health.js');
vi.mock('../services/facebook.js');
vi.mock('../services/leads.js');

const signInAs = (role) =>
  authService.restoreSession.mockResolvedValue({ ...session, user: { ...session.user, role } });

const form = (overrides = {}) => ({
  id: 'f1',
  pageId: '111',
  formId: '555',
  name: 'Spring Offer',
  status: 'ACTIVE',
  locale: 'en_US',
  questions: [{ key: 'email', label: 'Email', type: 'EMAIL' }],
  facebookLeadsCount: 8,
  storedLeads: 5,
  syncEnabled: true,
  backfillComplete: true,
  lastSyncedAt: '2026-11-01T10:00:00.000Z',
  lastSyncStatus: 'ok',
  lastSyncMessage: null,
  ...overrides,
});

const lead = (overrides = {}) => ({
  id: 'l1',
  pageId: '111',
  pageName: 'Acme Realty',
  formId: '555',
  formName: 'Spring Offer',
  facebookLeadId: 'lead-1',
  fullName: 'Priya Shah',
  email: 'priya@example.com',
  phone: '+15550001',
  customFields: [{ key: 'budget', value: '$500k' }],
  leadStatus: 'new',
  createdTime: '2026-10-31T11:59:00.000Z',
  source: 'facebook_lead_ads',
  assignedTo: null,
  syncedAt: '2026-11-01T10:00:00.000Z',
  ...overrides,
});

const leadPage = (leads, overrides = {}) => ({
  leads,
  total: leads.length,
  page: 1,
  limit: 25,
  totalPages: 1,
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  fetchHealth.mockResolvedValue({ status: 'ok' });
  signInAs('owner');
  facebookService.fetchPages.mockResolvedValue([{ pageId: '111', name: 'Acme Realty' }]);
  leadsService.fetchForms.mockResolvedValue([form()]);
});

describe('lead forms screen', () => {
  it('shows each form with its counts, Page and last sync', async () => {
    renderAt('/forms');

    const list = await screen.findByRole('list', { name: 'Lead forms' });
    expect(within(list).getByText('Spring Offer')).toBeInTheDocument();
    expect(within(list).getByText(/Acme Realty · Form ID 555/)).toBeInTheDocument();
    expect(within(list).getByText('ACTIVE')).toBeInTheDocument();
    expect(within(list).getByText('Leads here').nextSibling).toHaveTextContent('5');
    expect(within(list).getByText('Leads on Facebook').nextSibling).toHaveTextContent('8');
  });

  it('points to the Pages screen when no Page is connected', async () => {
    leadsService.fetchForms.mockResolvedValue([]);
    facebookService.fetchPages.mockResolvedValue([]);
    renderAt('/forms');

    expect(await screen.findByText('No lead forms yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pages screen' })).toHaveAttribute('href', '/pages');
  });

  it('tells an admin to refresh when a Page has no forms loaded yet', async () => {
    leadsService.fetchForms.mockResolvedValue([]);
    renderAt('/forms');

    expect(await screen.findByText(/Choose Refresh forms/)).toBeInTheDocument();
  });

  it('refreshes the forms from Facebook and says what it found', async () => {
    leadsService.refreshForms.mockResolvedValue({
      results: [{ pageId: '111', name: 'Acme Realty', status: 'ok', message: null, forms: 2 }],
      forms: [],
    });
    const user = userEvent.setup();
    renderAt('/forms');

    await user.click(await screen.findByRole('button', { name: 'Refresh forms' }));

    expect(await screen.findByText('2 forms found on 1 Page.')).toBeInTheDocument();
    await waitFor(() => expect(leadsService.fetchForms).toHaveBeenCalledTimes(2));
  });

  it('syncs all leads and reports how many were new', async () => {
    leadsService.syncLeads.mockResolvedValue({
      results: [{ formId: '555', name: 'Spring Offer', status: 'ok', message: null }],
      totals: { fetched: 5, created: 3 },
    });
    const user = userEvent.setup();
    renderAt('/forms');

    await user.click(await screen.findByRole('button', { name: 'Sync leads' }));

    expect(leadsService.syncLeads).toHaveBeenCalledWith();
    expect(await screen.findByText('3 new leads saved from 5 leads checked.')).toBeInTheDocument();
  });

  it('lists the forms that could not be synced and why', async () => {
    leadsService.syncLeads.mockResolvedValue({
      results: [
        { formId: '555', name: 'Spring Offer', status: 'ok', message: null },
        {
          formId: '666',
          name: 'Old Promo',
          status: 'permission',
          message: 'Facebook denied access to this Page’s leads.',
        },
        {
          formId: '777',
          name: 'Big Form',
          status: 'partial',
          message: 'More leads are waiting. Sync again to continue.',
        },
      ],
      totals: { fetched: 10, created: 10 },
    });
    const user = userEvent.setup();
    renderAt('/forms');

    await user.click(await screen.findByRole('button', { name: 'Sync leads' }));

    const notice = await screen.findByText('10 new leads saved from 10 leads checked.');
    const box = notice.closest('[role="status"]');
    expect(within(box).getByText(/Old Promo:/)).toBeInTheDocument();
    expect(within(box).getByText(/denied access/)).toBeInTheDocument();
    expect(within(box).getByText(/Big Form:/)).toBeInTheDocument();
    expect(within(box).getByText(/Sync again to continue/)).toBeInTheDocument();
  });

  it('syncs a single form', async () => {
    leadsService.syncLeads.mockResolvedValue({
      results: [{ formId: '555', name: 'Spring Offer', status: 'ok', message: null }],
      totals: { fetched: 1, created: 1 },
    });
    const user = userEvent.setup();
    renderAt('/forms');

    await user.click(await screen.findByRole('button', { name: 'Sync now' }));

    expect(leadsService.syncLeads).toHaveBeenCalledWith({ formId: '555' });
    expect(await screen.findByText('1 new lead saved from 1 lead checked.')).toBeInTheDocument();
  });

  it('shows an error when a sync request fails', async () => {
    leadsService.syncLeads.mockRejectedValue(
      apiError(404, { code: 'NOT_FOUND', message: 'Lead form not found' }),
    );
    const user = userEvent.setup();
    renderAt('/forms');

    await user.click(await screen.findByRole('button', { name: 'Sync leads' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Lead form not found');
  });

  it('switches a form in or out of automatic sync', async () => {
    leadsService.updateForm.mockResolvedValue(form({ syncEnabled: false }));
    const user = userEvent.setup();
    renderAt('/forms');

    const toggle = await screen.findByRole('checkbox', { name: 'Include in automatic sync' });
    expect(toggle).toBeChecked();
    await user.click(toggle);

    expect(leadsService.updateForm).toHaveBeenCalledWith('555', { syncEnabled: false });
    await waitFor(() => expect(leadsService.fetchForms).toHaveBeenCalledTimes(2));
  });

  it('shows why the last sync of a form failed', async () => {
    leadsService.fetchForms.mockResolvedValue([
      form({
        lastSyncedAt: null,
        lastSyncStatus: 'permission',
        lastSyncMessage: 'Facebook denied access to this Page’s leads.',
      }),
    ]);
    renderAt('/forms');

    expect(await screen.findByText(/denied access to this Page/)).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
  });

  it('offers no controls for a form Facebook has deleted', async () => {
    leadsService.fetchForms.mockResolvedValue([form({ status: 'DELETED' })]);
    renderAt('/forms');

    expect(await screen.findByText('DELETED')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument();
  });

  it('is read-only for plain members', async () => {
    signInAs('member');
    renderAt('/forms');

    expect(await screen.findByText('Spring Offer')).toBeInTheDocument();
    for (const name of ['Refresh forms', 'Sync leads', 'Sync now']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('offers a retry when the forms cannot be loaded', async () => {
    leadsService.fetchForms
      .mockRejectedValueOnce(
        apiError(500, { code: 'INTERNAL_ERROR', message: 'Something went wrong' }),
      )
      .mockResolvedValueOnce([form()]);
    const user = userEvent.setup();
    renderAt('/forms');

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Spring Offer')).toBeInTheDocument();
  });
});

describe('all leads screen', () => {
  beforeEach(() => {
    leadsService.fetchLeads.mockResolvedValue(leadPage([lead()]));
  });

  it('lists leads with contact details, form, date and status, each linking to its page', async () => {
    renderAt('/leads');

    const list = await screen.findByRole('list', { name: 'Leads' });
    const link = within(list).getByRole('link');
    expect(link).toHaveAttribute('href', '/leads/l1');
    expect(link).toHaveTextContent('Priya Shah');
    expect(link).toHaveTextContent('priya@example.com · +15550001');
    expect(link).toHaveTextContent('Spring Offer');
    expect(within(list).getByText('new')).toBeInTheDocument();
    expect(leadsService.fetchLeads).toHaveBeenCalledWith({ page: 1, limit: 25 });
  });

  it('copes with a lead that has no name or contact details', async () => {
    leadsService.fetchLeads.mockResolvedValue(
      leadPage([lead({ fullName: null, email: null, phone: null })]),
    );
    renderAt('/leads');

    expect(await screen.findByText('No name')).toBeInTheDocument();
    expect(screen.getByText('No contact details')).toBeInTheDocument();
  });

  it('points to the Lead Forms screen when there are no leads yet', async () => {
    leadsService.fetchLeads.mockResolvedValue(leadPage([]));
    renderAt('/leads');

    expect(await screen.findByText('No leads yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lead Forms screen' })).toHaveAttribute(
      'href',
      '/forms',
    );
  });

  it('pages through the leads', async () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      lead({ id: `l${index}`, fullName: `Lead ${index}` }),
    );
    leadsService.fetchLeads.mockResolvedValue(leadPage(many, { total: 60, totalPages: 3 }));
    const user = userEvent.setup();
    renderAt('/leads');

    expect(await screen.findByText('Showing 1–25 of 60')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    leadsService.fetchLeads.mockResolvedValue(
      leadPage(many, { total: 60, totalPages: 3, page: 2 }),
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() =>
      expect(leadsService.fetchLeads).toHaveBeenLastCalledWith({ page: 2, limit: 25 }),
    );
    expect(await screen.findByText('Showing 26–50 of 60')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
  });

  it('disables Next on the last page', async () => {
    leadsService.fetchLeads.mockResolvedValue(
      leadPage([lead()], { total: 26, page: 1, totalPages: 1 }),
    );
    renderAt('/leads');

    expect(await screen.findByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('filters by status and goes back to the first page', async () => {
    const user = userEvent.setup();
    renderAt('/leads');

    await user.selectOptions(await screen.findByLabelText('Status'), 'qualified');

    await waitFor(() =>
      expect(leadsService.fetchLeads).toHaveBeenLastCalledWith({
        page: 1,
        limit: 25,
        status: 'qualified',
      }),
    );
  });

  it('filters by form, using the workspace’s forms', async () => {
    const user = userEvent.setup();
    renderAt('/leads');

    await user.selectOptions(await screen.findByLabelText('Form'), '555');

    await waitFor(() =>
      expect(leadsService.fetchLeads).toHaveBeenLastCalledWith({
        page: 1,
        limit: 25,
        formId: '555',
      }),
    );
  });

  it('says so when no lead matches the filters', async () => {
    const user = userEvent.setup();
    renderAt('/leads');
    const status = await screen.findByLabelText('Status');
    leadsService.fetchLeads.mockResolvedValue(leadPage([]));
    await user.selectOptions(status, 'lost');

    expect(await screen.findByText('No leads match these filters')).toBeInTheDocument();
  });

  it('offers a retry when the leads cannot be loaded', async () => {
    leadsService.fetchLeads
      .mockRejectedValueOnce(
        apiError(500, { code: 'INTERNAL_ERROR', message: 'Something went wrong' }),
      )
      .mockResolvedValueOnce(leadPage([lead()]));
    const user = userEvent.setup();
    renderAt('/leads');

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Priya Shah')).toBeInTheDocument();
  });
});

describe('lead details screen', () => {
  it('shows the contact details, form answers and where the lead came from', async () => {
    leadsService.fetchLead.mockResolvedValue(lead());
    renderAt('/leads/l1');

    expect(await screen.findByRole('heading', { name: 'Priya Shah' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'priya@example.com' })).toHaveAttribute(
      'href',
      'mailto:priya@example.com',
    );
    expect(screen.getByRole('link', { name: '+15550001' })).toHaveAttribute(
      'href',
      'tel:+15550001',
    );
    expect(screen.getByText('budget')).toBeInTheDocument();
    expect(screen.getByText('$500k')).toBeInTheDocument();
    expect(screen.getByText('Spring Offer')).toBeInTheDocument();
    expect(screen.getByText('Acme Realty')).toBeInTheDocument();
    expect(screen.getByText('Facebook Lead Ads')).toBeInTheDocument();
    expect(screen.getByText('new')).toBeInTheDocument();
    expect(leadsService.fetchLead).toHaveBeenCalledWith('l1');
    expect(screen.getByRole('link', { name: /All leads/ })).toHaveAttribute('href', '/leads');
  });

  it('says what is missing instead of leaving blanks', async () => {
    leadsService.fetchLead.mockResolvedValue(
      lead({ fullName: null, email: null, phone: null, customFields: [] }),
    );
    renderAt('/leads/l1');

    expect(await screen.findByRole('heading', { name: 'No name' })).toBeInTheDocument();
    expect(screen.getAllByText('Not provided')).toHaveLength(2);
    expect(screen.getByText('No other answers were submitted.')).toBeInTheDocument();
  });

  it('shows the API’s message when the lead cannot be found', async () => {
    leadsService.fetchLead.mockRejectedValue(
      apiError(404, { code: 'NOT_FOUND', message: 'Lead not found' }),
    );
    renderAt('/leads/nope');

    expect(await screen.findByRole('alert')).toHaveTextContent('Lead not found');
    expect(screen.getByRole('link', { name: /All leads/ })).toBeInTheDocument();
  });
});
