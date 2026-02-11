/**
 * Plugin config - values from plugin.json
 * Import this instead of hardcoding plugin IDs or API paths.
 *
 * NOTE: keep in sync with plugin.json.  If the plugin id ever changes,
 * update plugin.json first – this file mirrors it.
 */

import manifest from '../plugin.json' assert { type: 'json' };

export const PLUGIN_ID: string = manifest.id;
export const PLUGIN_NAME: string = manifest.name;
export const API_PREFIX = `/plugins/${PLUGIN_ID}`;
