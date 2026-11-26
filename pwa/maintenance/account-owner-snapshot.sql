-- Capture before the 0009-before-Worker window, or before rollback, in the
-- approved database environment. Preserve securely with the migration evidence.
-- Raw values: owner is the mapped legacy identifier, otherwise auth_user.id.
SELECT u.id AS accountId, COALESCE(l.owner, u.id) AS owner
FROM auth_user u LEFT JOIN auth_legacy_owner l ON l.user_id=u.id
ORDER BY u.id;
