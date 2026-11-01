import { useState } from 'react';
import Alert from '../ui/Alert.jsx';
import Button from '../ui/Button.jsx';
import TextField from '../ui/TextField.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { getErrorMessage, getFieldErrors } from '../../utils/errors.js';
import { canManageWorkspace } from '../../utils/permissions.js';

export default function WorkspaceForm() {
  const { user, workspace, renameWorkspace } = useAuth();
  const canManage = canManageWorkspace(user.role);
  const [name, setName] = useState(workspace.name);
  const [status, setStatus] = useState({ type: null, message: null });
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus({ type: null, message: null });
    setFieldErrors({});
    setSaving(true);
    try {
      await renameWorkspace({ name });
      setStatus({ type: 'success', message: 'Workspace updated.' });
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
        label="Workspace name"
        autoComplete="organization"
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={fieldErrors.name}
        hint={canManage ? undefined : 'Only owners and admins can change the workspace name.'}
        disabled={!canManage}
        required
      />
      {canManage && (
        <Button type="submit" loading={saving} disabled={name.trim() === workspace.name}>
          Save changes
        </Button>
      )}
    </form>
  );
}
