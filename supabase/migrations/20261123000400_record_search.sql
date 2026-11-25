-- Full-text search over shared records (the search_records tool and GET /api/records/search).
-- Only adds: one generated column and its index. Row level security on miso.records is unchanged,
-- so a search sees exactly the records a member already sees.
--
-- What is indexed: the string and number values in `data`, not its keys (a search for "text"
-- shouldn't match every record that has a `text` field). The 'simple' config doesn't stem, so it
-- works the same for every language. The values are cut at 100,000 characters: a tsvector can't
-- pass 1 MB, and as a generated column an over-long one would make the write itself fail.

alter table miso.records
  add column search tsvector generated always as (
    to_tsvector(
      'simple'::regconfig,
      left(jsonb_path_query_array(data, 'strict $.** ? (@.type() == "string" || @.type() == "number")')::text, 100000)
    )
  ) stored;

create index records_search_idx on miso.records using gin (search);

comment on column miso.records.search is
  'Words of the string and number values in data (first 100,000 characters), for full-text search. See 20261123000400_record_search.sql.';
