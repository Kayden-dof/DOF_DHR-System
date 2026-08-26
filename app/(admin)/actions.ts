'use server';

import { redirect } from 'next/navigation';
import { endSession } from '@/lib/session';

export async function logout() {
  await endSession();
  redirect('/login');
}
