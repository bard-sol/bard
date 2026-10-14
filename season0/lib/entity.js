/** Scored things are entities. Season 0 only emits characters. A club can reuse the same records. */

export const CHARACTER = 'character';

export function asEntity(row, fallbackType) {
  const source = row || {};
  const raw = source.entity_id != null ? source.entity_id : (source.id != null ? source.id : source.charId);
  const entity_id = raw == null ? '' : String(raw);
  const entity_type = source.entity_type || fallbackType || CHARACTER;
  return { entity_id, entity_type };
}

/**
 * Tie-break and encounter material.
 * Characters stay on the historical id-only key so an existing draw does not move.
 * Any other type is prefixed so it cannot collide with a character of the same id.
 */
export function entityTieId(row) {
  const entity = asEntity(row);
  if (entity.entity_type === CHARACTER) return entity.entity_id;
  return entity.entity_type + '|' + entity.entity_id;
}

export function tagEntity(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const entity = asEntity(row);
  if (!entity.entity_id) return row;
  return {
    ...row,
    entity_id: entity.entity_id,
    entity_type: entity.entity_type,
    id: row.id != null ? row.id : entity.entity_id
  };
}
