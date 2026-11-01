import { useState } from 'react';
import Alert from '../ui/Alert.jsx';
import Button from '../ui/Button.jsx';
import TextField from '../ui/TextField.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { getErrorCode, getErrorMessage, getFieldErrors } from '../../utils/errors.js';

const EMPTY = { currentPassword: '', newPassword: '' };

export default function PasswordForm() {
  const { changePassword } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState({ type: null, message: null });
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus({ type: null, message: null });
    setFieldErrors({});
    setSaving(true);
    try {
      await changePassword(form);
      setForm(EMPTY);
      setStatus({
        type: 'success',
        message: 'Password updated. Your other devices have been signed out.',
      });
    } catch (err) {
      const fields = getFieldErrors(err);
      if (getErrorCode(err) === 'INVALID_CURRENT_PASSWORD') {
        fields.currentPassword = getErrorMessage(err);
      }
      setFieldErrors(fields);
      if (Object.keys(fields).length === 0) {
        setStatus({ type: 'error', message: getErrorMessage(err) });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {status.type && <Alert variant={status.type}>{status.message}</Alert>}
      <TextField
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={form.currentPassword}
        onChange={update('currentPassword')}
        error={fieldErrors.currentPassword}
        required
      />
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        value={form.newPassword}
        onChange={update('newPassword')}
        error={fieldErrors.newPassword}
        hint="At least 10 characters."
        required
      />
      <Button type="submit" loading={saving}>
        Update password
      </Button>
    </form>
  );
}
