import { useState } from 'react';
import { Link } from 'react-router';
import Alert from '../components/ui/Alert.jsx';
import Button from '../components/ui/Button.jsx';
import TextField from '../components/ui/TextField.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { getErrorMessage } from '../utils/errors.js';

export default function Login() {
  const { signIn } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(form);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-slate-500">Welcome back. Enter your details to continue.</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={update('email')}
          required
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={form.password}
          onChange={update('password')}
          required
        />
        <Button type="submit" loading={submitting} className="w-full">
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-sm text-slate-600">
        New to LeadSync?{' '}
        <Link to="/register" className="font-medium text-indigo-600 hover:text-indigo-500">
          Create an account
        </Link>
      </p>
    </>
  );
}
