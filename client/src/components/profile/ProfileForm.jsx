import { useState } from 'react';
import Alert from '../ui/Alert.jsx';
import Button from '../ui/Button.jsx';
import TextField from '../ui/TextField.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { getErrorMessage, getFieldErrors } from '../../utils/errors.js';

export default function ProfileForm() {
  const { user, workspace, updateProfile } = useAuth();
  const [name, setName] = useState(user.name);
  const [status, setStatus] = useState({ type: null, message: null });
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus({ type: null, message: null });
    setFieldErrors({});
    setSaving(true);
    try {
      await updateProfile({ name });
      setStatus({ type: 'success', message: 'Profile updated.' });
    } catch (err) {
      const fields = getFieldErrors(err);
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
        label="Name"
        autoComplete="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={fieldErrors.name}
        required
      />
      <TextField label="Email" value={user.email} disabled readOnly />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Workspace" value={workspace.name} disabled readOnly />
        <TextField
          label="Role"
          value={user.role}
          disabled
          readOnly
          className="[&_input]:capitalize"
        />
      </div>
      <Button type="submit" loading={saving}>
        Save changes
      </Button>
    </form>
  );
}
