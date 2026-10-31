/**
 * Module references: how a JSON app names code (function pipes, manager classes) it can't hold.
 *
 *     "options": { "pipes": { "plainText": { "import": "./pipes.js", "export": "plainText" } } }
 *
 * resolveModules loads each reference in the app's options, with dynamic import(), and puts the export in its
 * place. Relative specifiers resolve against the app's URL (where its JSON is); bare ones are left to the import
 * map. It's for the page, which runs the code; a worker only ever sees what prepareApp made of it (stand-ins).
 */

import type { ModuleReference, NavigateApp } from './types/navigate-gingerly/types.js';

/** `{ import }` or `{ import, export }`, and nothing else. */
export function isModuleReference(value: unknown): value is ModuleReference {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const { import: specifier, export: name } = value as Record<string, unknown>;
    return typeof specifier === 'string' && (name === undefined || typeof name === 'string')
        && Object.keys(value).every(key => key === 'import' || key === 'export');
}

/** A copy of the app, with each module reference in its options replaced by the export it names. */
export async function resolveModules<Config, Options>(app: NavigateApp<Config, Options>, appURL: string | URL): Promise<NavigateApp<Config, Options>> {
    if (app.options === undefined) return app;
    return { ...app, options: await resolve(app.options, String(appURL), 'options') };
}

async function resolve(value: any, appURL: string, path: string): Promise<any> {
    if (isModuleReference(value)) return load(value, appURL, path);
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return Promise.all(value.map((item, i) => resolve(item, appURL, `${path}.${i}`)));
    if (Object.getPrototypeOf(value) !== Object.prototype) return value;
    const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await resolve(item, appURL, `${path}.${key}`)]));
    return Object.fromEntries(entries);
}

async function load({ import: specifier, export: name = 'default' }: ModuleReference, appURL: string, path: string): Promise<unknown> {
    const relative = /^(\.{1,2}\/|\/)/.test(specifier) || /^[a-z][a-z\d+.-]*:/i.test(specifier);
    const module = await import(relative ? new URL(specifier, appURL).href : specifier);
    if (!(name in module)) throw new Error(`navigate-gingerly: ${path}: "${specifier}" has no export "${name}"`);
    return module[name];
}
