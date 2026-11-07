import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // Migrations rodam como administrador/dono; a API roda com DATABASE_URL (kronos_api, sem BYPASSRLS).
  datasource: { url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL ?? '' },
});
