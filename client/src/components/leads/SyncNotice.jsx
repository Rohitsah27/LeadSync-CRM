import Alert from '../ui/Alert.jsx';

/** What a sync did, plus the forms or Pages that need attention. See utils/leads.js. */
export default function SyncNotice({ notice }) {
  const hasProblems = notice.problems.length > 0;

  return (
    <Alert variant={hasProblems ? 'warning' : 'success'}>
      <p>{notice.summary}</p>
      {hasProblems && (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {notice.problems.map((problem) => (
            <li key={problem.name}>
              <strong>{problem.name}:</strong> {problem.message}
            </li>
          ))}
        </ul>
      )}
    </Alert>
  );
}
