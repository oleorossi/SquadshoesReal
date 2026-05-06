
-- 1. Corrigir dimensões do grupo PALMILHA
UPDATE product_groups 
SET dimensions_length = 1000, dimensions_width = 1500, dimensions_unit = 'mm'
WHERE id = '449bbeea-a38a-4526-afe2-2793a305ee2f';

-- 2. Corrigir dimensões da component_sheet da placa
UPDATE component_sheets 
SET dimensions_length = 1000, dimensions_width = 1500, dimensions_unit = 'mm'
WHERE product_id = 'caa8afb2-edd9-49b3-ae08-cc43c74f20a3';

-- 3. Corrigir quantity_per_unit: 4.166 / 150 = 0.0278 placa/par
UPDATE sheet_materials 
SET quantity_per_unit = 0.0278
WHERE id IN (
  '3a61a1a8-3287-410b-b07e-1ec9f0fb745a',
  '7ff8123a-9d9f-43b1-89ee-8a4308b2bba7',
  '5dcafe37-2f9c-4c6c-a6cf-52e1115588cc',
  '01a0fecf-f6dd-4979-9e4c-8327a1b783e8',
  '4a26e44b-922f-4e11-952e-fc1a0a595f9f',
  '4c605141-1a81-4d53-9292-e32df4bfb5ca',
  'cbf3ffa3-5ca0-4fd0-9551-8f3f4bcfa555'
);

-- 4. Atualizar insole_consumption nas fichas técnicas
UPDATE technical_sheets 
SET insole_consumption = 4.166
WHERE id IN (
  '54eb95c1-d296-4ced-8e73-8412a79a98d9',
  'f08bfcc3-857a-4df6-9f1e-80836fae2d48',
  '6f148d21-d541-4699-ace5-e86cd4de6909',
  'be373de2-84d3-469f-9d94-9adf37b5afab',
  'fd0bd19f-4e5b-4621-9c1e-43a5734a52d2',
  '22f5fc2d-f3b3-466a-ba33-cd3f306b267e',
  '25a8dc2f-131e-43a1-9f3c-9339ab147292'
)
