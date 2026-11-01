import { useState } from 'react';

const initialsOf = (name) =>
  (name ?? 'Page')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

/** A Page's profile picture, falling back to its initials when there is none or it fails to load. */
export default function PageAvatar({ name, url }) {
  const [failed, setFailed] = useState(false);

  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="size-12 shrink-0 rounded-lg object-cover"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="grid size-12 shrink-0 place-items-center rounded-lg bg-indigo-50 text-sm font-semibold text-indigo-700"
    >
      {initialsOf(name)}
    </span>
  );
}
