// Prints Drizzle table definitions for the Better Auth jwt and OAuth provider
// plugins, read from the installed packages. Run after upgrading either:
//   node --import tsx scripts/print-oauth-schema.ts
// and compare the output with the OAuth section of db/auth-schema.ts.
import { jwt } from 'better-auth/plugins';
import { oauthProvider } from '@better-auth/oauth-provider';

type Field = {
  type: string | string[];
  required?: boolean;
  unique?: boolean;
  index?: boolean;
  defaultValue?: unknown;
  references?: { model: string; field: string; onDelete?: string };
};
type Model = { modelName?: string; fields: Record<string, Field> };

const snake = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
const tableVariable: Record<string, string> = { user: 'user', session: 'session' };
// Deleting a user or a client removes what depends on it. Deleting a session
// (sign-out) must not fail or remove the tokens issued during it.
const onDelete = (field: string, declared?: string) =>
  field === 'sessionId' ? 'set null' : (declared ?? 'cascade');

const schemas: Record<string, Model> = {
  ...(jwt().schema as Record<string, Model>),
  ...(oauthProvider({ loginPage: '/login', consentPage: '/oauth/consent' })
    .schema as Record<string, Model>),
};
for (const [model, definition] of Object.entries(schemas)) {
  const indexes: string[] = [];
  const lines = ["  id: text('id').primaryKey(),"];
  for (const [name, field] of Object.entries(definition.fields)) {
    const column = snake(name);
    const type = Array.isArray(field.type) ? 'string' : field.type;
    let code =
      type === 'boolean'
        ? `integer('${column}', { mode: 'boolean' })`
        : type === 'number'
          ? `integer('${column}')`
          : type === 'date'
            ? `integer('${column}', { mode: 'timestamp_ms' })`
            : `text('${column}')`;
    if (field.required !== false) code += '.notNull()';
    if (field.unique) code += '.unique()';
    if (typeof field.defaultValue === 'boolean')
      code += `.default(${field.defaultValue})`;
    if (typeof field.defaultValue === 'number')
      code += `.default(${field.defaultValue})`;
    if (field.references) {
      const target = tableVariable[field.references.model] ?? field.references.model;
      code += `.references(() => ${target}.${field.references.field}, { onDelete: '${onDelete(name, field.references.onDelete)}' })`;
      indexes.push(`index('auth_${snake(model)}_${column}').on(t.${name})`);
    } else if (field.index && !field.unique)
      indexes.push(`index('auth_${snake(model)}_${column}').on(t.${name})`);
    const note = Array.isArray(field.type)
      ? ' // enum'
      : type === 'string[]' || type === 'json'
        ? ` // ${type}, stored as JSON text by the adapter`
        : '';
    lines.push(`  ${name}: ${code},${note}`);
  }
  console.log(
    `export const ${model} = sqliteTable('auth_${snake(model)}', {\n${lines.join('\n')}\n}${indexes.length ? `, (t) => [${indexes.join(', ')}]` : ''});`,
  );
}
