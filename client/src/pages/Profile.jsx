import { useState } from 'react';
import PasswordForm from '../components/profile/PasswordForm.jsx';
import ProfileForm from '../components/profile/ProfileForm.jsx';
import Alert from '../components/ui/Alert.jsx';
import Button from '../components/ui/Button.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { getErrorMessage } from '../utils/errors.js';

function Section({ title, description, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function Profile() {
  const { signOutEverywhere } = useAuth();
  const [error, setError] = useState(null);
  const [working, setWorking] = useState(false);

  async function handleSignOutEverywhere() {
    setError(null);
    setWorking(true);
    try {
      await signOutEverywhere();
    } catch (err) {
      setError(getErrorMessage(err));
      setWorking(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="mt-1 text-sm text-slate-500">Your account details and security.</p>
      </div>

      <Section title="Account">
        <ProfileForm />
      </Section>

      <Section title="Password" description="Changing your password signs out all other devices.">
        <PasswordForm />
      </Section>

      <Section
        title="Sessions"
        description="Sign out everywhere if you used a shared computer or suspect someone else has access."
      >
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Button variant="secondary" loading={working} onClick={handleSignOutEverywhere}>
            Sign out of all devices
          </Button>
        </div>
      </Section>
    </div>
  );
}
