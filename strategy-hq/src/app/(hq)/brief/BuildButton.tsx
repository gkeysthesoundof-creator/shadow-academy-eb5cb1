'use client';
import { useFormStatus } from 'react-dom';

export function BuildButton() {
  const { pending } = useFormStatus();
  return <button className="btn primary" type="submit" disabled={pending}>{pending ? 'Building…' : "Build today's brief now (dry run)"}</button>;
}
