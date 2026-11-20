import { extractSql, guardSql } from './sql-guard';
import { SQL_DEFAULT_LIMIT } from './sql-schema';

/**
 * These are the cases the guard exists for. They run with no database and no model, so the
 * boundary is checked on every `npm test` rather than only when an eval is run.
 */
describe('guardSql', () => {
  const ok = (sql: string) => {
    const result = guardSql(sql);
    if (!result.ok) throw new Error(`expected to pass, refused with: ${result.reason}`);
    return result.sql;
  };
  const refused = (sql: string) => {
    const result = guardSql(sql);
    expect(result.ok).toBe(false);
    return result.ok ? '' : result.reason;
  };

  describe('reads it allows', () => {
    it('passes a plain select and adds the missing limit', () => {
      expect(ok('SELECT "title" FROM "BrandProduct"')).toBe(`SELECT "title" FROM "BrandProduct" LIMIT ${SQL_DEFAULT_LIMIT}`);
    });

    it('keeps a limit the query already has', () => {
      expect(ok('SELECT "title" FROM "BrandProduct" LIMIT 10')).toBe('SELECT "title" FROM "BrandProduct" LIMIT 10');
    });

    it('allows joins between allow-listed tables', () => {
      expect(() => ok('SELECT b."name" FROM "BrandProduct" p JOIN "Brand" b ON b."id" = p."brandId" LIMIT 5')).not.toThrow();
    });

    it('allows a CTE and selecting from the name it defines', () => {
      expect(() => ok('WITH live AS (SELECT "price" FROM "BrandProduct") SELECT avg("price") FROM live LIMIT 1')).not.toThrow();
    });

    it('does not mistake createdAt or updatedAt for CREATE or UPDATE', () => {
      expect(() => ok('SELECT "createdAt", "updatedAt" FROM "BrandVideo" LIMIT 5')).not.toThrow();
    });

    it('does not mistake offset for SET', () => {
      expect(() => ok('SELECT "title" FROM "BrandProduct" OFFSET 10 LIMIT 5')).not.toThrow();
    });

    it('strips a trailing semicolon rather than refusing', () => {
      expect(ok('SELECT count(*) FROM "Brand" LIMIT 1;')).toBe('SELECT count(*) FROM "Brand" LIMIT 1');
    });
  });

  describe('writes it refuses', () => {
    it.each([
      ['DELETE FROM "BrandProduct"'],
      ['UPDATE "BrandProduct" SET "price" = 0'],
      ['INSERT INTO "Brand" ("name") VALUES (\'x\')'],
      ['DROP TABLE "Brand"'],
      ['TRUNCATE "Brand"'],
      ['ALTER TABLE "Brand" ADD COLUMN x int'],
      ['GRANT SELECT ON "Brand" TO public'],
    ])('refuses %s', (sql) => {
      expect(refused(sql)).toBeTruthy();
    });

    it('refuses a write smuggled in after a semicolon', () => {
      expect(refused('SELECT 1 FROM "Brand"; DROP TABLE "Brand"')).toMatch(/one statement/i);
    });

    it('refuses a query carrying a comment, where intent can hide', () => {
      expect(refused('SELECT "name" FROM "Brand" /* DELETE FROM "Brand" */ LIMIT 5')).toMatch(/comment/i);
      expect(refused('SELECT "name" FROM "Brand" -- DELETE FROM "Brand"')).toMatch(/comment/i);
    });

    it('refuses a CTE that writes', () => {
      expect(refused('WITH gone AS (DELETE FROM "Brand" RETURNING "id") SELECT * FROM gone')).toBeTruthy();
    });
  });

  describe('the boundary it keeps', () => {
    it('refuses a table outside the allow-list', () => {
      expect(refused('SELECT "email" FROM "User" LIMIT 5')).toMatch(/outside the allowed set/i);
    });

    it('refuses a join that reaches a table outside the allow-list', () => {
      expect(refused('SELECT u."id" FROM "Brand" b JOIN "User" u ON true LIMIT 5')).toMatch(/outside the allowed set/i);
    });

    it('refuses a sensitive column inside an allowed table', () => {
      expect(refused('SELECT "gstin" FROM "Brand" LIMIT 5')).toMatch(/not readable/i);
      expect(refused('SELECT "widgetKey" FROM "Brand" LIMIT 5')).toMatch(/not readable/i);
      expect(refused('SELECT "requestedBy" FROM "AiRequestLog" LIMIT 5')).toMatch(/not readable/i);
      expect(refused('SELECT "userId" FROM "BrandEvent" LIMIT 5')).toMatch(/not readable/i);
    });

    it('refuses reading the server rather than the data', () => {
      expect(refused("SELECT * FROM information_schema.columns LIMIT 5")).toBeTruthy();
      expect(refused('SELECT pg_sleep(10) FROM "Brand" LIMIT 1')).toBeTruthy();
      expect(refused('SELECT pg_read_file(\'/etc/passwd\') FROM "Brand" LIMIT 1')).toBeTruthy();
    });

    it('refuses a limit above the maximum', () => {
      expect(refused('SELECT "title" FROM "BrandProduct" LIMIT 100000')).toMatch(/maximum/i);
    });

    it('refuses anything that is not a read', () => {
      expect(refused('EXPLAIN SELECT 1 FROM "Brand"')).toMatch(/SELECT or WITH/i);
      expect(refused('')).toBeTruthy();
    });
  });
});

describe('extractSql', () => {
  it('takes the statement out of a fenced block', () => {
    expect(extractSql('Here you go:\n```sql\nSELECT 1 FROM "Brand"\n```\n')).toBe('SELECT 1 FROM "Brand"');
  });

  it('accepts a bare statement', () => {
    expect(extractSql('SELECT 1 FROM "Brand"')).toBe('SELECT 1 FROM "Brand"');
  });

  it('keeps UNANSWERABLE intact so the agent can see it', () => {
    expect(extractSql('UNANSWERABLE')).toBe('UNANSWERABLE');
  });
});
