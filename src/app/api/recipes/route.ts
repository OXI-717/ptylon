import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { loadAllRecipes } from '@/lib/recipe-loader';
import { verifyAdminRequest } from '@/lib/admin-auth';

function checkAuth(req: NextRequest): boolean {
  const token = req.cookies.get('wc-token')?.value;
  if (token && verifyToken(token)) return true;
  return verifyAdminRequest(req) === null;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await loadAllRecipes());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid .web-console.json' }, { status: 400 });
  }
}
