/**
 * The labelled mapping tasks. Labels were written from the payloads and the targets before the engine was
 * scored on them (2026-11-14), and are not edited to match its output; a wrong label found later is fixed in
 * its own commit that says so.
 *
 * A label is the source the field should come from, written the way the engine names sources:
 *   'properties.mag'                  a path
 *   'a + b'                           concat of two paths
 *   'a or b'                          coalesce
 *   'count(laureates[])'              count
 *   'laureates[]'                     the source array for a target array
 *   'laureates[].fullName.en'         a field inside it (target children), or values() for a list of scalars
 *   null                              nothing in the samples fits: right when the tool says so
 */
export interface Task {
  id: string;
  family: string;
  sample: string;
  recordRoot?: string[];
  /** The target as a JSON Schema. The example-record and column-list kinds are derived from it. */
  schema: Record<string, unknown>;
  labels: Record<string, string | null>;
  /** Kinds this task is run under. Default: all three. */
  kinds?: ('schema' | 'example' | 'columns')[];
}

const S = (props: Record<string, unknown>, required: string[] = []) => ({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: props, required });
const str = (extra: Record<string, unknown> = {}) => ({ type: 'string', ...extra });
const int = { type: 'integer' };
const num = { type: 'number' };
const bool = { type: 'boolean' };

export const TASKS: Task[] = [
  // ---------- USGS earthquakes (real)
  {
    id: 'usgs-quakes', family: 'nesting changes', sample: 'usgs-quakes.json',
    schema: S({ event_id: str(), magnitude: num, place: str(), occurred_at: str({ format: 'date-time' }), updated_at: str({ format: 'date-time' }), url: str({ format: 'uri' }), magnitude_type: str(), felt_reports: int }, ['event_id', 'magnitude']),
    labels: { event_id: 'id', magnitude: 'properties.mag', place: 'properties.place', occurred_at: 'properties.time', updated_at: 'properties.updated', url: 'properties.url', magnitude_type: 'properties.magType', felt_reports: 'properties.felt' },
  },
  {
    id: 'usgs-decoys', family: 'decoys', sample: 'usgs-quakes.json',
    schema: S({ event_type: str({ enum: ['earthquake', 'quarry blast', 'explosion', 'ice quake', 'other event'] }), title: str(), review_status: str({ enum: ['automatic', 'reviewed', 'deleted'] }), network: str(), significance: int }),
    labels: { event_type: 'properties.type', title: 'properties.title', review_status: 'properties.status', network: 'properties.net', significance: 'properties.sig' },
  },
  {
    id: 'usgs-no-source', family: 'no good source', sample: 'usgs-quakes.json',
    schema: S({ country: str(), insured_loss_usd: num, magnitude: num, aftershock_count: int }),
    labels: { country: null, insured_loss_usd: null, magnitude: 'properties.mag', aftershock_count: null },
  },
  // ---------- Nobel prizes (real)
  {
    id: 'nobel-prizes', family: 'line items', sample: 'nobel-prizes.json',
    schema: S({
      year: int, category: str(), prize_amount: int, awarded_on: str({ format: 'date' }),
      laureates: { type: 'array', items: { type: 'object', properties: { laureate_id: str(), full_name: str(), motivation: str(), portion: str() } } },
    }),
    labels: { year: 'awardYear', category: 'category.en', prize_amount: 'prizeAmount', awarded_on: 'dateAwarded', 'laureates[]': 'laureates[]', 'laureates[].laureate_id': 'laureates[].id', 'laureates[].full_name': 'laureates[].fullName.en', 'laureates[].motivation': 'laureates[].motivation.en', 'laureates[].portion': 'laureates[].portion' },
  },
  {
    id: 'nobel-counts', family: 'line items', sample: 'nobel-prizes.json',
    schema: S({ award_year: str(), laureate_count: int, full_category_name: str() }),
    labels: { award_year: 'awardYear', laureate_count: 'count(laureates[])', full_category_name: 'categoryFullName.en' },
  },
  // ---------- OpenAlex works (real)
  {
    id: 'openalex-works', family: 'line items', sample: 'openalex-works.json',
    schema: S({
      work_id: str({ format: 'uri' }), doi: str({ format: 'uri' }), title: str(), year: int, published_on: str({ format: 'date' }), citations: int, open_access: bool, language: str(),
      authors: { type: 'array', items: { type: 'object', properties: { name: str(), orcid: { type: ['string', 'null'], format: 'uri' }, position: str({ enum: ['first', 'middle', 'last'] }) } } },
    }, ['work_id', 'title']),
    labels: { work_id: 'id', doi: 'doi', title: 'title', year: 'publication_year', published_on: 'publication_date', citations: 'cited_by_count', open_access: 'open_access.is_oa', language: 'language', 'authors[]': 'authorships[]', 'authors[].name': 'authorships[].author.display_name', 'authors[].orcid': 'authorships[].author.orcid', 'authors[].position': 'authorships[].author_position' },
  },
  {
    id: 'openalex-author-list', family: 'line items', sample: 'openalex-works.json',
    schema: S({ title: str(), author_names: { type: 'array', items: str() }, first_page: str(), volume: str() }),
    labels: { title: 'title', 'author_names[]': 'authorships[].author.display_name', first_page: 'biblio.first_page', volume: 'biblio.volume' },
  },
  // ---------- NWS forecast periods (real)
  {
    id: 'nws-periods', family: 'clean renames', sample: 'nws-forecast.json', recordRoot: ['properties', 'periods'],
    schema: S({ period_name: str(), starts_at: str({ format: 'date-time' }), ends_at: str({ format: 'date-time' }), temp_f: int, is_daytime: bool, rain_chance_pct: int, wind_speed: str(), short_forecast: str(), detailed_forecast: str(), icon_url: str({ format: 'uri' }) }),
    labels: { period_name: 'name', starts_at: 'startTime', ends_at: 'endTime', temp_f: 'temperature', is_daytime: 'isDaytime', rain_chance_pct: 'probabilityOfPrecipitation.value', wind_speed: 'windSpeed', short_forecast: 'shortForecast', detailed_forecast: 'detailedForecast', icon_url: 'icon' },
  },
  // ---------- FEC candidates (real)
  {
    id: 'fec-candidates', family: 'enum codes', sample: 'fec-candidates.json',
    schema: S({ candidate_id: str(), candidate_name: str(), state: str({ pattern: '^[A-Z]{2}$' }), party_name: str(), office: str({ enum: ['H', 'S', 'P'] }), first_filed_on: str({ format: 'date' }), last_filed_on: str({ format: 'date' }), active_through: int }),
    labels: { candidate_id: 'candidate_id', candidate_name: 'name', state: 'state', party_name: 'party_full', office: 'office', first_filed_on: 'first_file_date', last_filed_on: 'last_file_date', active_through: 'active_through' },
  },
  // ---------- Synthetic vendor payloads
  {
    id: 'orders-three-prices', family: 'three-prices ambiguity', sample: 'synthetic-orders-prices.json',
    schema: S({ order_ref: str(), price: { type: 'number', description: 'What the customer paid' }, placed_at: str({ format: 'date-time' }), customer_email: str({ format: 'email' }), currency: str({ pattern: '^[A-Z]{3}$' }) }),
    labels: { order_ref: 'order_id', price: 'sale_price', placed_at: 'placed_at', customer_email: 'customer.email', currency: 'currency' },
  },
  {
    id: 'orders-split-names', family: 'split and joined names', sample: 'synthetic-orders-prices.json',
    schema: S({ customer_name: str(), customer_id: str(), order_id: str() }),
    labels: { customer_name: 'customer.first_name + customer.last_name', customer_id: 'customer.id', order_id: 'order_id' },
  },
  {
    id: 'orders-line-items', family: 'line items', sample: 'synthetic-orders-prices.json',
    schema: S({ id: str(), items: { type: 'array', items: { type: 'object', properties: { sku: str(), quantity: int, unit_price: { type: 'number', multipleOf: 0.01 } } } } }),
    labels: { id: 'order_id', 'items[]': 'line_items[]', 'items[].sku': 'line_items[].sku', 'items[].quantity': 'line_items[].quantity', 'items[].unit_price': 'line_items[].unit_price_cents' },
  },
  {
    id: 'orders-cents', family: 'cents vs dollars', sample: 'synthetic-orders-cents.json',
    schema: S({ order_id: str(), amount: num, total: num, created_at: str({ format: 'date-time' }), status: str({ enum: ['paid', 'refunded', 'pending'] }), email: str({ format: 'email' }) }),
    labels: { order_id: 'id', amount: 'amount', total: 'total_cents', created_at: 'created', status: 'status', email: 'buyer.email_address' },
  },
  {
    id: 'orders-sometimes-present', family: 'sometimes-present fields', sample: 'synthetic-orders-drift.ndjson',
    schema: S({ reference: str(), email: str({ format: 'email' }), phone: str(), name: str() }),
    labels: { reference: 'ref', email: 'email or contact.email', phone: 'phone', name: 'given_name + family_name' },
  },
  {
    id: 'orders-epochs', family: 'epochs', sample: 'synthetic-orders-drift.ndjson',
    schema: S({ updated_at: str({ format: 'date-time' }), recorded_on: str({ format: 'date' }) }),
    labels: { updated_at: 'updated', recorded_on: 'ts_ns' },
  },
  {
    id: 'accounts-big-ints', family: 'big-integer IDs', sample: 'synthetic-accounts-bigint.json',
    schema: S({ account_number: str(), id: str(), display_name: str(), active: bool, score: int }),
    labels: { account_number: 'account_id', id: 'id', display_name: 'name', active: 'is_active', score: 'score' },
  },
  {
    id: 'accounts-decoy-id', family: 'decoys', sample: 'synthetic-accounts-bigint.json',
    schema: S({ account_id: str(), user_email: str({ format: 'email' }) }),
    labels: { account_id: 'account_id', user_email: null },
  },
];
