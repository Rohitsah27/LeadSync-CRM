import { useCallback } from 'react';
import { Link, useParams } from 'react-router';
import LeadStatusBadge from '../components/leads/LeadStatusBadge.jsx';
import Alert from '../components/ui/Alert.jsx';
import Section from '../components/ui/Section.jsx';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { fetchLead } from '../services/leads.js';
import { formatDateTime } from '../utils/format.js';

const SOURCES = { facebook_lead_ads: 'Facebook Lead Ads', facebook_organic: 'Facebook (organic)' };

function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-slate-900">{children}</dd>
    </div>
  );
}

export default function LeadDetails() {
  const { leadId } = useParams();
  const load = useCallback(() => fetchLead(leadId), [leadId]);
  const { status, data: lead, error } = useAsyncData(load);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/leads" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
        &larr; All leads
      </Link>

      {status === 'loading' && (
        <p role="status" className="text-sm text-slate-500">
          Loading lead&hellip;
        </p>
      )}

      {status === 'error' && <Alert>{error}</Alert>}

      {status === 'ready' && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {lead.fullName ?? 'No name'}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Received {formatDateTime(lead.createdTime)}
              </p>
            </div>
            <LeadStatusBadge status={lead.leadStatus} />
          </div>

          <Section title="Contact">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Email">
                {lead.email ? (
                  <a
                    href={`mailto:${lead.email}`}
                    className="text-indigo-600 hover:text-indigo-500"
                  >
                    {lead.email}
                  </a>
                ) : (
                  'Not provided'
                )}
              </Detail>
              <Detail label="Phone">
                {lead.phone ? (
                  <a href={`tel:${lead.phone}`} className="text-indigo-600 hover:text-indigo-500">
                    {lead.phone}
                  </a>
                ) : (
                  'Not provided'
                )}
              </Detail>
            </dl>
          </Section>

          <Section title="Form answers">
            {lead.customFields.length === 0 ? (
              <p className="text-sm text-slate-500">No other answers were submitted.</p>
            ) : (
              <dl className="grid gap-4 sm:grid-cols-2">
                {lead.customFields.map((field) => (
                  <Detail key={field.key} label={field.key}>
                    {field.value}
                  </Detail>
                ))}
              </dl>
            )}
          </Section>

          <Section title="Source">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Form">{lead.formName ?? lead.formId}</Detail>
              <Detail label="Page">{lead.pageName ?? lead.pageId}</Detail>
              <Detail label="Channel">{SOURCES[lead.source] ?? lead.source}</Detail>
              <Detail label="Imported">{formatDateTime(lead.syncedAt) ?? 'Unknown'}</Detail>
            </dl>
          </Section>
        </>
      )}
    </div>
  );
}
