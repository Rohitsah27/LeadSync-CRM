import { useState } from 'react';
import { Link } from 'react-router';
import Alert from '../components/ui/Alert.jsx';
import Button from '../components/ui/Button.jsx';
import TextField from '../components/ui/TextField.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { getErrorMessage, getFieldErrors } from '../utils/errors.js';

export default function Register() {
  const { signUp } = useAuth();
  const [form, setForm] = useState({ name: '', businessName: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await signUp(form);
    } catch (err) {
      const fields = getFieldErrors(err);
      setFieldErrors(fields);
      setError(Object.keys(fields).length > 0 ? null : getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-slate-500">
        Set up a workspace for your business. You can connect Facebook once you are in.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Your name"
          autoComplete="name"
          value={form.name}
          onChange={update('name')}
          error={fieldErrors.name}
          required
        />
        <TextField
          label="Business name"
          autoComplete="organization"
          value={form.businessName}
          onChange={update('businessName')}
          error={fieldErrors.businessName}
          required
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={update('email')}
          error={fieldErrors.email}
          required
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={update('password')}
          error={fieldErrors.password}
          hint="At least 10 characters."
          required
        />
        <Button type="submit" loading={submitting} className="w-full">
          Create account
        </Button>
      </form>

      <p className="mt-6 text-sm text-slate-600">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
          Sign in
        </Link>
      </p>
    </>
  );
}
