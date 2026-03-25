-- Training Settings: key-value store for admin-configurable runtime settings
create table if not exists training_settings (
  key   text primary key,
  value text not null default ''
);

-- Seed with the Apps Script URL key (empty by default — admin fills it in)
insert into training_settings (key, value)
values ('apps_script_url', '')
on conflict (key) do nothing;
