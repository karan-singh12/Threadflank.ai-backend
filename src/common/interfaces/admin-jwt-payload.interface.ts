import { AdminRole } from '@prisma/client';

// Structure of the decoded Admin JWT payload. Deliberately shaped differently
// from the end-user JwtPayload (adminUserId vs userId) and signed with a
// separate secret so a user token can never be replayed as an admin token.
export interface AdminJwtPayload {
  adminUserId: string;
  email: string;
  role: AdminRole;
  iat?: number;
  exp?: number;
}

export type AuthenticatedAdmin = AdminJwtPayload;
