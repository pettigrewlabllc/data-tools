import orders from '../../fixtures/samples/synthetic-orders-prices.json?raw';
import quakes from '../../fixtures/samples/usgs-quakes.json?raw';

export interface Sample { id: string; label: string; file: string; text: string; source: string; target: string; note: string }

const schema = (props: Record<string, unknown>, required: string[] = []) => JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', required, properties: props }, null, 2);

export const SAMPLES: Sample[] = [
  {
    id: 'orders', label: 'the vendor orders', file: 'orders.json', text: orders,
    source: 'Made up for this tool (fixtures/synthetic.ts). Three prices per order, line items with prices in cents.',
    note: 'Three prices, line items, and a price in cents.',
    target: schema({
      order_id: { type: 'string' },
      price: { type: 'number', description: 'What the customer paid' },
      placed_at: { type: 'string', format: 'date-time' },
      customer: { type: 'object', properties: { email: { type: 'string', format: 'email' }, name: { type: 'string' } } },
      items: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' }, quantity: { type: 'integer' }, unit_price: { type: 'number', multipleOf: 0.01 } } } },
    }, ['order_id', 'price']),
  },
  {
    id: 'quakes', label: 'USGS earthquakes', file: 'usgs-4.5-week.geojson', text: quakes,
    source: 'U.S. Geological Survey, M4.5+ earthquakes in the past week. Public domain.',
    note: 'Real GeoJSON, with times in epoch milliseconds.',
    target: schema({
      event_id: { type: 'string' }, magnitude: { type: 'number' }, place: { type: 'string' },
      occurred_at: { type: 'string', format: 'date-time' }, url: { type: 'string', format: 'uri' },
      felt_reports: { type: 'integer' }, tsunami_flag: { type: 'boolean' }, country: { type: 'string' },
    }, ['event_id', 'magnitude']),
  },
];
