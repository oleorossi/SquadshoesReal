SELECT jsonb_build_object(
  'columns',(
    SELECT jsonb_agg(jsonb_build_object(
      'name',c.column_name,
      'type',c.data_type,
      'nullable',c.is_nullable,
      'default',c.column_default
    ) ORDER BY c.ordinal_position)
      FROM information_schema.columns c
     WHERE c.table_schema='supabase_migrations'
       AND c.table_name='schema_migrations'
  ),
  'constraints',(
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name',tc.constraint_name,
      'type',tc.constraint_type,
      'columns',(
        SELECT jsonb_agg(kcu.column_name ORDER BY kcu.ordinal_position)
          FROM information_schema.key_column_usage kcu
         WHERE kcu.constraint_schema=tc.constraint_schema
           AND kcu.constraint_name=tc.constraint_name
      )
    ) ORDER BY tc.constraint_name),'[]'::jsonb)
      FROM information_schema.table_constraints tc
     WHERE tc.table_schema='supabase_migrations'
       AND tc.table_name='schema_migrations'
  ),
  'latest_rows',(
    SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.version DESC),'[]'::jsonb)
      FROM (
        SELECT * FROM supabase_migrations.schema_migrations
         ORDER BY version DESC LIMIT 25
      ) m
  )
) AS audit;
