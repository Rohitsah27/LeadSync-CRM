const MAX_CUSTOM_FIELDS = 50;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clip = (value, length) => (value ? value.slice(0, length) : null);

/**
 * Turns Facebook's `field_data` ([{ name, values }]) into the fields the CRM shows. Standard
 * questions (name, email, phone) become columns; everything else is kept as custom fields, so no
 * answer is dropped. An email that is not valid stays in the custom fields instead of the column.
 */
export function mapLeadFields(fieldData) {
  const entries = (Array.isArray(fieldData) ? fieldData : [])
    .filter((field) => field && typeof field.name === 'string')
    .map((field) => ({
      name: field.name,
      value: (Array.isArray(field.values) ? field.values : [])
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
        .join(', '),
    }));

  const used = new Set();
  const pick = (names, accept = () => true) => {
    for (const name of names) {
      const entry = entries.find(
        (candidate) =>
          candidate.name.toLowerCase() === name &&
          candidate.value &&
          !used.has(candidate) &&
          accept(candidate.value),
      );
      if (entry) {
        used.add(entry);
        return entry.value;
      }
    }
    return null;
  };

  const fullName = pick(['full_name']);
  const firstName = pick(['first_name']);
  const lastName = pick(['last_name']);
  const email = pick(['email', 'work_email'], (value) => EMAIL_PATTERN.test(value));
  const phone = pick(['phone_number', 'phone', 'work_phone_number']);

  const customFields = entries
    .filter((entry) => entry.value && !used.has(entry))
    .slice(0, MAX_CUSTOM_FIELDS)
    .map((entry) => ({ key: entry.name.slice(0, 200), value: entry.value.slice(0, 2000) }));

  return {
    fullName: clip(fullName ?? ([firstName, lastName].filter(Boolean).join(' ') || null), 200),
    email: email ? email.toLowerCase().slice(0, 254) : null,
    phone: clip(phone, 50),
    customFields,
  };
}
