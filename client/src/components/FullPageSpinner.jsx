import { Loader2 } from 'lucide-react';

export default function FullPageSpinner() {
  return (
    <div role="status" aria-label="Loading" className="grid min-h-screen place-items-center">
      <Loader2 className="size-8 animate-spin text-indigo-600" aria-hidden="true" />
    </div>
  );
}
