
-- Remove incorrect DALIA group: set products to ungrouped, then delete the group
UPDATE products SET group_id = NULL WHERE group_id = 'a65534a9-5a2b-4b2c-ae60-501c4d5934ba';
DELETE FROM product_groups WHERE id = 'a65534a9-5a2b-4b2c-ae60-501c4d5934ba';
