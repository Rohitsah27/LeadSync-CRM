export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost'];

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Turns the API's per-form sync results into a short summary plus anything that needs attention. */
export function summarizeLeadSync({ results, totals }) {
  return {
    summary:
      results.length === 0
        ? 'There were no forms to sync.'
        : `${plural(totals.created, 'new lead')} saved from ${plural(totals.fetched, 'lead')} checked.`,
    problems: results
      .filter((result) => result.status !== 'ok')
      .map((result) => ({
        name: result.name ?? `Form ${result.formId}`,
        message: result.message,
      })),
  };
}

export function summarizeFormRefresh({ results }) {
  const found = results.reduce((sum, result) => sum + result.forms, 0);
  return {
    summary: `${plural(found, 'form')} found on ${plural(results.length, 'Page')}.`,
    problems: results
      .filter((result) => result.status !== 'ok')
      .map((result) => ({ name: result.name ?? `Page ${result.pageId}`, message: result.message })),
  };
}
