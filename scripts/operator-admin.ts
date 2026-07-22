import dotenv from 'dotenv';
import { prisma } from '../server/db';
import { hashOperatorPassword, normalizeOperatorEmail } from '../server/operatorAuth/crypto';
import { auditSecurityEvent } from '../server/operatorAuth/audit';

dotenv.config();

const command = process.argv[2] || '';

async function createOperator() {
  const email = normalizeOperatorEmail(process.env.OPERATOR_BOOTSTRAP_EMAIL);
  const password = String(process.env.OPERATOR_BOOTSTRAP_PASSWORD || '');
  const displayName = String(process.env.OPERATOR_BOOTSTRAP_DISPLAY_NAME || '').trim() || null;
  if (!email || !password) {
    throw new Error('OPERATOR_BOOTSTRAP_EMAIL and OPERATOR_BOOTSTRAP_PASSWORD are required.');
  }
  const existing = await prisma.operator.findUnique({ where: { normalizedEmail: email } });
  if (existing) throw new Error('Operator already exists.');
  const operator = await prisma.operator.create({
    data: {
      email,
      normalizedEmail: email,
      displayName,
      passwordHash: hashOperatorPassword(password),
      role: 'ADMIN'
    }
  });
  auditSecurityEvent('operator.cli.create', { operatorId: operator.id, email: operator.email });
  console.log(`Created operator ${operator.email}`);
}

async function resetPassword() {
  const email = normalizeOperatorEmail(process.env.OPERATOR_BOOTSTRAP_EMAIL);
  const password = String(process.env.OPERATOR_BOOTSTRAP_PASSWORD || '');
  if (!email || !password) {
    throw new Error('OPERATOR_BOOTSTRAP_EMAIL and OPERATOR_BOOTSTRAP_PASSWORD are required.');
  }
  const operator = await prisma.operator.update({
    where: { normalizedEmail: email },
    data: { passwordHash: hashOperatorPassword(password) }
  });
  await prisma.operatorSession.updateMany({
    where: { operatorId: operator.id, revokedAt: null },
    data: { revokedAt: new Date() }
  });
  auditSecurityEvent('operator.cli.password_reset', { operatorId: operator.id, email: operator.email });
  console.log(`Reset password and revoked sessions for ${operator.email}`);
}

async function listOperators() {
  const operators = await prisma.operator.findMany({
    select: { id: true, email: true, displayName: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
    orderBy: { createdAt: 'asc' }
  });
  console.table(operators);
}

async function revokeSessions() {
  const email = normalizeOperatorEmail(process.env.OPERATOR_BOOTSTRAP_EMAIL);
  if (!email) throw new Error('OPERATOR_BOOTSTRAP_EMAIL is required.');
  const operator = await prisma.operator.findUnique({ where: { normalizedEmail: email } });
  if (!operator) throw new Error('Operator not found.');
  await prisma.operatorSession.updateMany({
    where: { operatorId: operator.id, revokedAt: null },
    data: { revokedAt: new Date() }
  });
  auditSecurityEvent('operator.cli.sessions_revoked', { operatorId: operator.id, email: operator.email });
  console.log(`Revoked sessions for ${operator.email}`);
}

async function main() {
  if (command === 'create') return createOperator();
  if (command === 'reset-password') return resetPassword();
  if (command === 'list') return listOperators();
  if (command === 'revoke-sessions') return revokeSessions();
  console.error('Usage: tsx scripts/operator-admin.ts create|reset-password|list|revoke-sessions');
  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
