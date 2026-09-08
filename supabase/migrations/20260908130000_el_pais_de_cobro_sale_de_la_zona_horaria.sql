-- ============================================================================
-- Enséñame Ya — el país de cobro sale de la ZONA HORARIA, y deja de elegirse
--
-- Decisión del cliente (8-sep-2026): el tutor no declara dónde cobra. Se deduce
-- de `profiles.timezone`, que es un dato que YA mantiene —es con el que publica
-- sus horarios y con el que se le pintan las reservas— y que por eso está mucho
-- más vivo que un desplegable que se rellena una vez y no se vuelve a mirar.
--
-- Con el desplegable se va también `PayoutCountryForm` y el `grant update`
-- que lo sostenía.
--
-- ── POR QUÉ ESTO NO ROMPE LA VENTA (RN-33) ─────────────────────────────────
--
-- El primer diseño de esta migración escribía el país SOLO si tenía fila propia
-- en `payment_routing_rules`, porque un país sin fila activa deja las mentorías
-- del tutor sin vender: `create_booking_line` levanta «sin ruta de pago
-- disponible para el destino». Con 19 países en la tabla, deducir 'ES' de
-- `Europe/Madrid` habría dejado a ese tutor sin poder vender.
--
-- Esa precaución YA NO HACE FALTA y por eso no está: desde `20260903190000`
-- existe la fila `es_por_defecto`, que cubre a España, EE. UU. y a cualquier
-- destino sin regla propia con `{stripe, paypal, wise}`. `ruta_de_pago()` cae
-- en ella sola. O sea que hoy TODO país deducible es vendible, y escribir el
-- que diga la zona horaria es seguro.
--
-- ── Y POR QUÉ UNA TABLA Y NO UN `case` EN LA FUNCIÓN ───────────────────────
--
-- Porque son 418 zonas y el mapa no es nuestro: sale de `zone.tab` de la tzdb,
-- la misma fuente de la que el navegador saca la lista que ve el tutor
-- (`Intl.supportedValuesOf('timeZone')`, 418 entradas — coinciden una a una).
-- Como tabla se corrige con un `insert` el día que la tzdb mueva una zona, que
-- es lo que pasó con `Europe/Kiev` → `Europe/Kyiv`.
--
-- ⚠️ Los 19 nombres HEREDADOS que el runtime todavía sirve y que `zone.tab` ya
-- no lista (`America/Buenos_Aires`, `Asia/Calcutta`, `Europe/Kiev`…) están
-- resueltos con la lista `backward` de la tzdb, NO comparando los ficheros
-- compilados: dos zonas con las mismas reglas producen el MISMO binario, y ese
-- atajo ponía Asmara en Yibuti, Rangún en las islas Cocos y Truk en la
-- Antártida. Cinco de esos 19 son argentinos, y Argentina es país de payout.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · EL MAPA
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.timezone_countries (
  timezone text primary key,
  country  char(2) not null check (country ~ '^[A-Z]{2}$')
);

comment on table public.timezone_countries is
  'Zona horaria IANA → país (ISO-3166-1 alpha-2). Sale de zone.tab de la tzdb, la misma fuente de la que el navegador saca la lista que ve el tutor: 418 zonas, que coinciden una a una con Intl.supportedValuesOf(''timeZone''). Es el mapa con el que pais_de_cobro_por_zona() deduce tutor_profiles.payout_country desde profiles.timezone. Los 19 nombres heredados (America/Buenos_Aires, Asia/Calcutta, Europe/Kiev…) están resueltos con la lista backward de la tzdb y no comparando ficheros compilados, que es un atajo que confunde zonas con las mismas reglas.';

-- Catálogo público: es geografía, no dato de nadie. Mismo criterio que
-- `payout_manual_channels`, que también es documentación de producto.
alter table public.timezone_countries enable row level security;

drop policy if exists "timezone_countries_select_all" on public.timezone_countries;
create policy "timezone_countries_select_all"
  on public.timezone_countries for select to anon, authenticated
  using ( true );

grant select on public.timezone_countries to anon, authenticated;
-- Regla de oro 9: el trigger de abajo es SECURITY DEFINER, pero el grant va
-- igual para que cualquier job pueda leerla sin comerse un `permission denied`
-- en tiempo de ejecución.
grant select on public.timezone_countries to service_role;

insert into public.timezone_countries (timezone, country) values
  ('Africa/Abidjan', 'CI'),
  ('Africa/Accra', 'GH'),
  ('Africa/Addis_Ababa', 'ET'),
  ('Africa/Algiers', 'DZ'),
  ('Africa/Asmera', 'ER'),
  ('Africa/Bamako', 'ML'),
  ('Africa/Bangui', 'CF'),
  ('Africa/Banjul', 'GM'),
  ('Africa/Bissau', 'GW'),
  ('Africa/Blantyre', 'MW'),
  ('Africa/Brazzaville', 'CG'),
  ('Africa/Bujumbura', 'BI'),
  ('Africa/Cairo', 'EG'),
  ('Africa/Casablanca', 'MA'),
  ('Africa/Ceuta', 'ES'),
  ('Africa/Conakry', 'GN'),
  ('Africa/Dakar', 'SN'),
  ('Africa/Dar_es_Salaam', 'TZ'),
  ('Africa/Djibouti', 'DJ'),
  ('Africa/Douala', 'CM'),
  ('Africa/El_Aaiun', 'EH'),
  ('Africa/Freetown', 'SL'),
  ('Africa/Gaborone', 'BW'),
  ('Africa/Harare', 'ZW'),
  ('Africa/Johannesburg', 'ZA'),
  ('Africa/Juba', 'SS'),
  ('Africa/Kampala', 'UG'),
  ('Africa/Khartoum', 'SD'),
  ('Africa/Kigali', 'RW'),
  ('Africa/Kinshasa', 'CD'),
  ('Africa/Lagos', 'NG'),
  ('Africa/Libreville', 'GA'),
  ('Africa/Lome', 'TG'),
  ('Africa/Luanda', 'AO'),
  ('Africa/Lubumbashi', 'CD'),
  ('Africa/Lusaka', 'ZM'),
  ('Africa/Malabo', 'GQ'),
  ('Africa/Maputo', 'MZ'),
  ('Africa/Maseru', 'LS'),
  ('Africa/Mbabane', 'SZ'),
  ('Africa/Mogadishu', 'SO'),
  ('Africa/Monrovia', 'LR'),
  ('Africa/Nairobi', 'KE'),
  ('Africa/Ndjamena', 'TD'),
  ('Africa/Niamey', 'NE'),
  ('Africa/Nouakchott', 'MR'),
  ('Africa/Ouagadougou', 'BF'),
  ('Africa/Porto-Novo', 'BJ'),
  ('Africa/Sao_Tome', 'ST'),
  ('Africa/Tripoli', 'LY'),
  ('Africa/Tunis', 'TN'),
  ('Africa/Windhoek', 'NA'),
  ('America/Adak', 'US'),
  ('America/Anchorage', 'US'),
  ('America/Anguilla', 'AI'),
  ('America/Antigua', 'AG'),
  ('America/Araguaina', 'BR'),
  ('America/Argentina/La_Rioja', 'AR'),
  ('America/Argentina/Rio_Gallegos', 'AR'),
  ('America/Argentina/Salta', 'AR'),
  ('America/Argentina/San_Juan', 'AR'),
  ('America/Argentina/San_Luis', 'AR'),
  ('America/Argentina/Tucuman', 'AR'),
  ('America/Argentina/Ushuaia', 'AR'),
  ('America/Aruba', 'AW'),
  ('America/Asuncion', 'PY'),
  ('America/Bahia', 'BR'),
  ('America/Bahia_Banderas', 'MX'),
  ('America/Barbados', 'BB'),
  ('America/Belem', 'BR'),
  ('America/Belize', 'BZ'),
  ('America/Blanc-Sablon', 'CA'),
  ('America/Boa_Vista', 'BR'),
  ('America/Bogota', 'CO'),
  ('America/Boise', 'US'),
  ('America/Buenos_Aires', 'AR'),
  ('America/Cambridge_Bay', 'CA'),
  ('America/Campo_Grande', 'BR'),
  ('America/Cancun', 'MX'),
  ('America/Caracas', 'VE'),
  ('America/Catamarca', 'AR'),
  ('America/Cayenne', 'GF'),
  ('America/Cayman', 'KY'),
  ('America/Chicago', 'US'),
  ('America/Chihuahua', 'MX'),
  ('America/Ciudad_Juarez', 'MX'),
  ('America/Coral_Harbour', 'CA'),
  ('America/Cordoba', 'AR'),
  ('America/Costa_Rica', 'CR'),
  ('America/Coyhaique', 'CL'),
  ('America/Creston', 'CA'),
  ('America/Cuiaba', 'BR'),
  ('America/Curacao', 'CW'),
  ('America/Danmarkshavn', 'GL'),
  ('America/Dawson', 'CA'),
  ('America/Dawson_Creek', 'CA'),
  ('America/Denver', 'US'),
  ('America/Detroit', 'US'),
  ('America/Dominica', 'DM'),
  ('America/Edmonton', 'CA'),
  ('America/Eirunepe', 'BR'),
  ('America/El_Salvador', 'SV'),
  ('America/Fort_Nelson', 'CA'),
  ('America/Fortaleza', 'BR'),
  ('America/Glace_Bay', 'CA'),
  ('America/Godthab', 'GL'),
  ('America/Goose_Bay', 'CA'),
  ('America/Grand_Turk', 'TC'),
  ('America/Grenada', 'GD'),
  ('America/Guadeloupe', 'GP'),
  ('America/Guatemala', 'GT'),
  ('America/Guayaquil', 'EC'),
  ('America/Guyana', 'GY'),
  ('America/Halifax', 'CA'),
  ('America/Havana', 'CU'),
  ('America/Hermosillo', 'MX'),
  ('America/Indiana/Knox', 'US'),
  ('America/Indiana/Marengo', 'US'),
  ('America/Indiana/Petersburg', 'US'),
  ('America/Indiana/Tell_City', 'US'),
  ('America/Indiana/Vevay', 'US'),
  ('America/Indiana/Vincennes', 'US'),
  ('America/Indiana/Winamac', 'US'),
  ('America/Indianapolis', 'US'),
  ('America/Inuvik', 'CA'),
  ('America/Iqaluit', 'CA'),
  ('America/Jamaica', 'JM'),
  ('America/Jujuy', 'AR'),
  ('America/Juneau', 'US'),
  ('America/Kentucky/Monticello', 'US'),
  ('America/Kralendijk', 'BQ'),
  ('America/La_Paz', 'BO'),
  ('America/Lima', 'PE'),
  ('America/Los_Angeles', 'US'),
  ('America/Louisville', 'US'),
  ('America/Lower_Princes', 'SX'),
  ('America/Maceio', 'BR'),
  ('America/Managua', 'NI'),
  ('America/Manaus', 'BR'),
  ('America/Marigot', 'MF'),
  ('America/Martinique', 'MQ'),
  ('America/Matamoros', 'MX'),
  ('America/Mazatlan', 'MX'),
  ('America/Mendoza', 'AR'),
  ('America/Menominee', 'US'),
  ('America/Merida', 'MX'),
  ('America/Metlakatla', 'US'),
  ('America/Mexico_City', 'MX'),
  ('America/Miquelon', 'PM'),
  ('America/Moncton', 'CA'),
  ('America/Monterrey', 'MX'),
  ('America/Montevideo', 'UY'),
  ('America/Montserrat', 'MS'),
  ('America/Nassau', 'BS'),
  ('America/New_York', 'US'),
  ('America/Nome', 'US'),
  ('America/Noronha', 'BR'),
  ('America/North_Dakota/Beulah', 'US'),
  ('America/North_Dakota/Center', 'US'),
  ('America/North_Dakota/New_Salem', 'US'),
  ('America/Ojinaga', 'MX'),
  ('America/Panama', 'PA'),
  ('America/Paramaribo', 'SR'),
  ('America/Phoenix', 'US'),
  ('America/Port_of_Spain', 'TT'),
  ('America/Port-au-Prince', 'HT'),
  ('America/Porto_Velho', 'BR'),
  ('America/Puerto_Rico', 'PR'),
  ('America/Punta_Arenas', 'CL'),
  ('America/Rankin_Inlet', 'CA'),
  ('America/Recife', 'BR'),
  ('America/Regina', 'CA'),
  ('America/Resolute', 'CA'),
  ('America/Rio_Branco', 'BR'),
  ('America/Santarem', 'BR'),
  ('America/Santiago', 'CL'),
  ('America/Santo_Domingo', 'DO'),
  ('America/Sao_Paulo', 'BR'),
  ('America/Scoresbysund', 'GL'),
  ('America/Sitka', 'US'),
  ('America/St_Barthelemy', 'BL'),
  ('America/St_Johns', 'CA'),
  ('America/St_Kitts', 'KN'),
  ('America/St_Lucia', 'LC'),
  ('America/St_Thomas', 'VI'),
  ('America/St_Vincent', 'VC'),
  ('America/Swift_Current', 'CA'),
  ('America/Tegucigalpa', 'HN'),
  ('America/Thule', 'GL'),
  ('America/Tijuana', 'MX'),
  ('America/Toronto', 'CA'),
  ('America/Tortola', 'VG'),
  ('America/Vancouver', 'CA'),
  ('America/Whitehorse', 'CA'),
  ('America/Winnipeg', 'CA'),
  ('America/Yakutat', 'US'),
  ('Antarctica/Casey', 'AQ'),
  ('Antarctica/Davis', 'AQ'),
  ('Antarctica/DumontDUrville', 'AQ'),
  ('Antarctica/Macquarie', 'AU'),
  ('Antarctica/Mawson', 'AQ'),
  ('Antarctica/McMurdo', 'AQ'),
  ('Antarctica/Palmer', 'AQ'),
  ('Antarctica/Rothera', 'AQ'),
  ('Antarctica/Syowa', 'AQ'),
  ('Antarctica/Troll', 'AQ'),
  ('Antarctica/Vostok', 'AQ'),
  ('Arctic/Longyearbyen', 'SJ'),
  ('Asia/Aden', 'YE'),
  ('Asia/Almaty', 'KZ'),
  ('Asia/Amman', 'JO'),
  ('Asia/Anadyr', 'RU'),
  ('Asia/Aqtau', 'KZ'),
  ('Asia/Aqtobe', 'KZ'),
  ('Asia/Ashgabat', 'TM'),
  ('Asia/Atyrau', 'KZ'),
  ('Asia/Baghdad', 'IQ'),
  ('Asia/Bahrain', 'BH'),
  ('Asia/Baku', 'AZ'),
  ('Asia/Bangkok', 'TH'),
  ('Asia/Barnaul', 'RU'),
  ('Asia/Beirut', 'LB'),
  ('Asia/Bishkek', 'KG'),
  ('Asia/Brunei', 'BN'),
  ('Asia/Calcutta', 'IN'),
  ('Asia/Chita', 'RU'),
  ('Asia/Colombo', 'LK'),
  ('Asia/Damascus', 'SY'),
  ('Asia/Dhaka', 'BD'),
  ('Asia/Dili', 'TL'),
  ('Asia/Dubai', 'AE'),
  ('Asia/Dushanbe', 'TJ'),
  ('Asia/Famagusta', 'CY'),
  ('Asia/Gaza', 'PS'),
  ('Asia/Hebron', 'PS'),
  ('Asia/Hong_Kong', 'HK'),
  ('Asia/Hovd', 'MN'),
  ('Asia/Irkutsk', 'RU'),
  ('Asia/Jakarta', 'ID'),
  ('Asia/Jayapura', 'ID'),
  ('Asia/Jerusalem', 'IL'),
  ('Asia/Kabul', 'AF'),
  ('Asia/Kamchatka', 'RU'),
  ('Asia/Karachi', 'PK'),
  ('Asia/Katmandu', 'NP'),
  ('Asia/Khandyga', 'RU'),
  ('Asia/Krasnoyarsk', 'RU'),
  ('Asia/Kuala_Lumpur', 'MY'),
  ('Asia/Kuching', 'MY'),
  ('Asia/Kuwait', 'KW'),
  ('Asia/Macau', 'MO'),
  ('Asia/Magadan', 'RU'),
  ('Asia/Makassar', 'ID'),
  ('Asia/Manila', 'PH'),
  ('Asia/Muscat', 'OM'),
  ('Asia/Nicosia', 'CY'),
  ('Asia/Novokuznetsk', 'RU'),
  ('Asia/Novosibirsk', 'RU'),
  ('Asia/Omsk', 'RU'),
  ('Asia/Oral', 'KZ'),
  ('Asia/Phnom_Penh', 'KH'),
  ('Asia/Pontianak', 'ID'),
  ('Asia/Pyongyang', 'KP'),
  ('Asia/Qatar', 'QA'),
  ('Asia/Qostanay', 'KZ'),
  ('Asia/Qyzylorda', 'KZ'),
  ('Asia/Rangoon', 'MM'),
  ('Asia/Riyadh', 'SA'),
  ('Asia/Saigon', 'VN'),
  ('Asia/Sakhalin', 'RU'),
  ('Asia/Samarkand', 'UZ'),
  ('Asia/Seoul', 'KR'),
  ('Asia/Shanghai', 'CN'),
  ('Asia/Singapore', 'SG'),
  ('Asia/Srednekolymsk', 'RU'),
  ('Asia/Taipei', 'TW'),
  ('Asia/Tashkent', 'UZ'),
  ('Asia/Tbilisi', 'GE'),
  ('Asia/Tehran', 'IR'),
  ('Asia/Thimphu', 'BT'),
  ('Asia/Tokyo', 'JP'),
  ('Asia/Tomsk', 'RU'),
  ('Asia/Ulaanbaatar', 'MN'),
  ('Asia/Urumqi', 'CN'),
  ('Asia/Ust-Nera', 'RU'),
  ('Asia/Vientiane', 'LA'),
  ('Asia/Vladivostok', 'RU'),
  ('Asia/Yakutsk', 'RU'),
  ('Asia/Yekaterinburg', 'RU'),
  ('Asia/Yerevan', 'AM'),
  ('Atlantic/Azores', 'PT'),
  ('Atlantic/Bermuda', 'BM'),
  ('Atlantic/Canary', 'ES'),
  ('Atlantic/Cape_Verde', 'CV'),
  ('Atlantic/Faeroe', 'FO'),
  ('Atlantic/Madeira', 'PT'),
  ('Atlantic/Reykjavik', 'IS'),
  ('Atlantic/South_Georgia', 'GS'),
  ('Atlantic/St_Helena', 'SH'),
  ('Atlantic/Stanley', 'FK'),
  ('Australia/Adelaide', 'AU'),
  ('Australia/Brisbane', 'AU'),
  ('Australia/Broken_Hill', 'AU'),
  ('Australia/Darwin', 'AU'),
  ('Australia/Eucla', 'AU'),
  ('Australia/Hobart', 'AU'),
  ('Australia/Lindeman', 'AU'),
  ('Australia/Lord_Howe', 'AU'),
  ('Australia/Melbourne', 'AU'),
  ('Australia/Perth', 'AU'),
  ('Australia/Sydney', 'AU'),
  ('Europe/Amsterdam', 'NL'),
  ('Europe/Andorra', 'AD'),
  ('Europe/Astrakhan', 'RU'),
  ('Europe/Athens', 'GR'),
  ('Europe/Belgrade', 'RS'),
  ('Europe/Berlin', 'DE'),
  ('Europe/Bratislava', 'SK'),
  ('Europe/Brussels', 'BE'),
  ('Europe/Bucharest', 'RO'),
  ('Europe/Budapest', 'HU'),
  ('Europe/Busingen', 'DE'),
  ('Europe/Chisinau', 'MD'),
  ('Europe/Copenhagen', 'DK'),
  ('Europe/Dublin', 'IE'),
  ('Europe/Gibraltar', 'GI'),
  ('Europe/Guernsey', 'GG'),
  ('Europe/Helsinki', 'FI'),
  ('Europe/Isle_of_Man', 'IM'),
  ('Europe/Istanbul', 'TR'),
  ('Europe/Jersey', 'JE'),
  ('Europe/Kaliningrad', 'RU'),
  ('Europe/Kiev', 'UA'),
  ('Europe/Kirov', 'RU'),
  ('Europe/Lisbon', 'PT'),
  ('Europe/Ljubljana', 'SI'),
  ('Europe/London', 'GB'),
  ('Europe/Luxembourg', 'LU'),
  ('Europe/Madrid', 'ES'),
  ('Europe/Malta', 'MT'),
  ('Europe/Mariehamn', 'AX'),
  ('Europe/Minsk', 'BY'),
  ('Europe/Monaco', 'MC'),
  ('Europe/Moscow', 'RU'),
  ('Europe/Oslo', 'NO'),
  ('Europe/Paris', 'FR'),
  ('Europe/Podgorica', 'ME'),
  ('Europe/Prague', 'CZ'),
  ('Europe/Riga', 'LV'),
  ('Europe/Rome', 'IT'),
  ('Europe/Samara', 'RU'),
  ('Europe/San_Marino', 'SM'),
  ('Europe/Sarajevo', 'BA'),
  ('Europe/Saratov', 'RU'),
  ('Europe/Simferopol', 'UA'),
  ('Europe/Skopje', 'MK'),
  ('Europe/Sofia', 'BG'),
  ('Europe/Stockholm', 'SE'),
  ('Europe/Tallinn', 'EE'),
  ('Europe/Tirane', 'AL'),
  ('Europe/Ulyanovsk', 'RU'),
  ('Europe/Vaduz', 'LI'),
  ('Europe/Vatican', 'VA'),
  ('Europe/Vienna', 'AT'),
  ('Europe/Vilnius', 'LT'),
  ('Europe/Volgograd', 'RU'),
  ('Europe/Warsaw', 'PL'),
  ('Europe/Zagreb', 'HR'),
  ('Europe/Zurich', 'CH'),
  ('Indian/Antananarivo', 'MG'),
  ('Indian/Chagos', 'IO'),
  ('Indian/Christmas', 'CX'),
  ('Indian/Cocos', 'CC'),
  ('Indian/Comoro', 'KM'),
  ('Indian/Kerguelen', 'TF'),
  ('Indian/Mahe', 'SC'),
  ('Indian/Maldives', 'MV'),
  ('Indian/Mauritius', 'MU'),
  ('Indian/Mayotte', 'YT'),
  ('Indian/Reunion', 'RE'),
  ('Pacific/Apia', 'WS'),
  ('Pacific/Auckland', 'NZ'),
  ('Pacific/Bougainville', 'PG'),
  ('Pacific/Chatham', 'NZ'),
  ('Pacific/Easter', 'CL'),
  ('Pacific/Efate', 'VU'),
  ('Pacific/Enderbury', 'KI'),
  ('Pacific/Fakaofo', 'TK'),
  ('Pacific/Fiji', 'FJ'),
  ('Pacific/Funafuti', 'TV'),
  ('Pacific/Galapagos', 'EC'),
  ('Pacific/Gambier', 'PF'),
  ('Pacific/Guadalcanal', 'SB'),
  ('Pacific/Guam', 'GU'),
  ('Pacific/Honolulu', 'US'),
  ('Pacific/Kiritimati', 'KI'),
  ('Pacific/Kosrae', 'FM'),
  ('Pacific/Kwajalein', 'MH'),
  ('Pacific/Majuro', 'MH'),
  ('Pacific/Marquesas', 'PF'),
  ('Pacific/Midway', 'UM'),
  ('Pacific/Nauru', 'NR'),
  ('Pacific/Niue', 'NU'),
  ('Pacific/Norfolk', 'NF'),
  ('Pacific/Noumea', 'NC'),
  ('Pacific/Pago_Pago', 'AS'),
  ('Pacific/Palau', 'PW'),
  ('Pacific/Pitcairn', 'PN'),
  ('Pacific/Ponape', 'FM'),
  ('Pacific/Port_Moresby', 'PG'),
  ('Pacific/Rarotonga', 'CK'),
  ('Pacific/Saipan', 'MP'),
  ('Pacific/Tahiti', 'PF'),
  ('Pacific/Tarawa', 'KI'),
  ('Pacific/Tongatapu', 'TO'),
  ('Pacific/Truk', 'FM'),
  ('Pacific/Wake', 'UM'),
  ('Pacific/Wallis', 'WF')
on conflict (timezone) do update set country = excluded.country;

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · LA DEDUCCIÓN, Y EL DISPARADOR QUE LA APLICA
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.pais_de_cobro_por_zona(p_timezone text)
returns char(2)
language sql
stable
set search_path = ''
as $$
  -- 'UTC' NO significa «vive en UTC»: es el default de `profiles.timezone` y el
  -- valor al que cae el servidor cuando no encuentra nada. Es el mismo criterio
  -- que `zonaConfigurada()` en `lib/auth/server.ts` y que `TimezoneSync`, y
  -- tratarlo como país sería deducir uno de la ausencia de dato.
  select c.country
    from public.timezone_countries c
   where p_timezone is not null
     and p_timezone <> 'UTC'
     and c.timezone = p_timezone;
$$;

comment on function public.pais_de_cobro_por_zona(text) is
  'Zona horaria IANA → país de cobro. NULL cuando la zona es UTC (el default de profiles.timezone: ausencia de dato, no un país) o cuando no está en el mapa. La usa el trigger de profiles para mantener tutor_profiles.payout_country, que desde el 8-sep-2026 ya no lo elige el tutor.';

create or replace function public.sincroniza_pais_de_cobro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pais char(2);
begin
  v_pais := public.pais_de_cobro_por_zona(new.timezone);

  -- ⚠️ NO se escribe null encima de un país que ya estaba. Una zona
  -- desconocida o un `UTC` de vuelta —un navegador de CI, un Linux con TZ=UTC,
  -- un perfil recién creado— significan «no lo sé», y «no lo sé» no puede
  -- borrar lo que sí se sabía: eso mandaría al tutor a la fila de ruteo de
  -- 'simulated' y dejaría de poder cobrar sin que nadie tocara nada.
  if v_pais is null then
    return new;
  end if;

  -- Solo tutores: la tabla es suya y un alumno no tiene fila. Sin filas
  -- afectadas no pasa nada, que es lo correcto.
  -- ⚠️ `new.id`, no `new.profile_id`: el disparador está en `profiles`, cuya PK
  -- es `id`; `profile_id` es como se llama esa misma persona en
  -- `tutor_profiles`. Escrito al revés, `create or replace` lo acepta sin
  -- pestañear —valida la sintaxis, no el cuerpo (regla de oro 11)— y revienta
  -- la PRIMERA vez que alguien cambia su zona horaria, que es semanas después.
  update public.tutor_profiles
     set payout_country = v_pais
   where profile_id = new.id
     and payout_country is distinct from v_pais;

  return new;
end $$;

comment on function public.sincroniza_pais_de_cobro() is
  'Mantiene tutor_profiles.payout_country a partir de profiles.timezone. Es SECURITY DEFINER porque el tutor ya NO tiene grant update sobre payout_country: desde el 8-sep-2026 el país no se elige, se deduce. Una zona que no está en el mapa —o el UTC de «nadie la fijó»— deja el país como estaba en vez de borrarlo: null mandaría al tutor a la fila de ruteo simulated y dejaría de poder cobrar sin que nadie hubiese tocado nada.';

drop trigger if exists profiles_sincroniza_pais_de_cobro on public.profiles;
create trigger profiles_sincroniza_pais_de_cobro
  after insert or update of timezone on public.profiles
  for each row execute function public.sincroniza_pais_de_cobro();

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · EL TUTOR YA NO LO ELIGE
--
-- El desplegable se ha ido de la pantalla; quitarle el grant es lo que impide
-- que vuelva por la puerta de atrás. `tutor_profiles_update_own` sigue en pie
-- para las otras columnas (bio, headline, redes…): lo que se cierra es ESTA.
-- ════════════════════════════════════════════════════════════════════════════

revoke update (payout_country) on public.tutor_profiles from authenticated;
revoke insert (payout_country) on public.tutor_profiles from authenticated;

comment on column public.tutor_profiles.payout_country is
  'País donde cobra el tutor. Desde el 8-sep-2026 NO lo elige él: lo deduce el trigger profiles_sincroniza_pais_de_cobro desde profiles.timezone, y authenticated ya no tiene grant de insert ni update sobre esta columna. Decide qué rieles se le ofrecen (ruta_de_pago) y, con la fila es_por_defecto de payment_routing_rules, todo país deducible es además vendible — que es lo que hace seguro deducirlo. NULL = su zona horaria es UTC (nadie la fijó) o no está en timezone_countries.';

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · BACKFILL — los que ya estaban
-- ════════════════════════════════════════════════════════════════════════════

-- ⚠️ Solo se RELLENA lo vacío; no se pisa un país ya declarado. Un tutor que
-- eligió el suyo a mano cuando el desplegable existía sabía lo que hacía, y
-- puede estar viajando: sobrescribirlo con la zona de hoy sería cambiarle de
-- sitio el dinero sin avisar. El día que cambie su zona horaria, el trigger lo
-- pone al día — y eso sí es una acción suya.
update public.tutor_profiles tp
   set payout_country = public.pais_de_cobro_por_zona(p.timezone)
  from public.profiles p
 where p.id = tp.profile_id
   and tp.payout_country is null
   and public.pais_de_cobro_por_zona(p.timezone) is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- 5 · COMPROBACIONES
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  n int;
  v_pais char(2);
begin
  -- 1) El mapa está entero. 418 es lo que sirve `Intl.supportedValuesOf` en el
  --    runtime que pinta el desplegable: si aquí hubiese menos, habría zonas
  --    elegibles que no deducen país.
  select count(*) into n from public.timezone_countries;
  if n <> 418 then
    raise exception 'timezone_countries tiene % filas, se esperaban 418', n;
  end if;

  -- 2) Los 19 países que hoy tienen fila de ruteo propia son deducibles. Si un
  --    día se abre uno cuya zona no esté en el mapa, sus tutores se quedarían
  --    sin país y esto lo dice en el despliegue, no tres semanas después.
  select string_agg(c, ', ') into v_pais from unnest(array[
    'AR','BO','BR','CL','CO','CR','DO','EC','GT','ID','KE','MX','MY','NG','PA','PE','PY','UY','VE'
  ]) c where not exists (
    select 1 from public.timezone_countries t where t.country = c
  );
  if v_pais is not null then
    raise exception 'países de ruteo sin ninguna zona horaria en el mapa: %', v_pais;
  end if;

  -- 3) Los casos que el atajo de comparar binarios se llevaba por delante.
  if public.pais_de_cobro_por_zona('America/Buenos_Aires') <> 'AR' then
    raise exception 'el alias America/Buenos_Aires no resuelve a AR';
  end if;
  if public.pais_de_cobro_por_zona('Africa/Asmera') <> 'ER' then
    raise exception 'Asmara resuelve mal (el atajo del binario la ponía en Yibuti)';
  end if;
  if public.pais_de_cobro_por_zona('Asia/Rangoon') <> 'MM' then
    raise exception 'Rangún resuelve mal (el atajo del binario la ponía en las Cocos)';
  end if;

  -- 4) Y los dos que importan para esta pantalla.
  if public.pais_de_cobro_por_zona('America/Caracas') <> 'VE'
     or public.pais_de_cobro_por_zona('Europe/Madrid') <> 'ES' then
    raise exception 'Caracas o Madrid no resuelven a su país';
  end if;

  -- 5) 'UTC' es ausencia de dato, no un país.
  if public.pais_de_cobro_por_zona('UTC') is not null then
    raise exception 'UTC no puede deducir país: es el default de la columna';
  end if;

  -- 6) España es DEDUCIBLE y además VENDIBLE. Es la comprobación que autoriza a
  --    esta migración a escribir países sin fila propia: sin la fila
  --    es_por_defecto, un tutor español dejaría de poder vender.
  if (select payout_providers from public.ruta_de_pago('ES')) is null
     or (select payout_providers from public.ruta_de_pago('ES')) = array['simulated'] then
    raise exception 'ES no rutea a ningún riel: deducir su país dejaría al tutor sin vender';
  end if;

  -- 7) El tutor ya no puede tocar la columna por PostgREST.
  if has_column_privilege('authenticated', 'public.tutor_profiles', 'payout_country', 'update') then
    raise exception 'authenticated todavía puede escribir payout_country';
  end if;
end $$;

-- ⚠️ Y LA COMPROBACIÓN QUE DE VERDAD IMPORTA: DISPARAR EL TRIGGER.
--
-- Todo lo de arriba pasaba con el cuerpo mal escrito (`new.profile_id`, que en
-- `profiles` no existe): `create or replace` valida la SINTAXIS, no ejecuta el
-- cuerpo. Es literalmente la regla de oro 11, y aquí mordió — el fallo salió al
-- cambiarle la zona horaria a un tutor a mano, no en el despliegue.
--
-- Así que se cambia una zona horaria de verdad, se mira que el país la haya
-- seguido, y se deja todo como estaba.
do $$
declare
  v_id       uuid;
  v_tz_antes text;
  v_pais_antes char(2);
  v_pais_despues char(2);
begin
  select tp.profile_id, p.timezone, tp.payout_country
    into v_id, v_tz_antes, v_pais_antes
    from public.tutor_profiles tp
    join public.profiles p on p.id = tp.profile_id
   limit 1;

  if v_id is null then
    raise notice 'sin tutores: el disparador no se puede ejercitar aquí';
    return;
  end if;

  -- Caracas, que es país de ruteo y no coincide con ninguna zona de dev.
  update public.profiles set timezone = 'America/Caracas' where id = v_id;
  select payout_country into v_pais_despues
    from public.tutor_profiles where profile_id = v_id;

  -- Se deshace ANTES de levantar la excepción: si no, un fallo aquí dejaría a
  -- ese tutor cobrando en Venezuela por culpa de una comprobación.
  update public.profiles set timezone = v_tz_antes where id = v_id;
  update public.tutor_profiles set payout_country = v_pais_antes where profile_id = v_id;

  if v_pais_despues is distinct from 'VE' then
    raise exception 'el disparador no propagó la zona horaria: payout_country quedó en % y se esperaba VE', v_pais_despues;
  end if;
end $$;
