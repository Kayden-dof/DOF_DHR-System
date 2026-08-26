import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import LoginForm from './login-form';

export default async function LoginPage() {
  if (await currentUser()) redirect('/');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-7 text-center">
        <p className="text-2xl font-bold tracking-tight text-brand">DOF</p>
        <h1 className="mt-1 text-base font-semibold text-ink">DHR 지원 시스템</h1>
        <p className="mt-1 text-xs text-muted">제조기록 지원 도구 · DX2401</p>
      </div>
      <LoginForm />
    </main>
  );
}
