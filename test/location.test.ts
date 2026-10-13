import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { locationParts } from '../src/helpers.js';

describe('locationParts', () => {
  test('splits "City, Region, Country" on the first and last comma and trims each part', () => {
    assert.deepEqual(locationParts('City, Region, Country'), { city: 'City', country: 'Country' });
    assert.deepEqual(locationParts('Bengaluru, Karnataka, India'), { city: 'Bengaluru', country: 'India' });
    assert.deepEqual(locationParts(' Lisbon ,  Portugal '), { city: 'Lisbon', country: 'Portugal' });
  });

  test('a bare string is the city', () => {
    assert.deepEqual(locationParts('Bengaluru'), { city: 'Bengaluru' });
  });

  test('blank or missing locations have no parts', () => {
    for (const value of [undefined, '', '   ', ' , ', ',,']) assert.deepEqual(locationParts(value), {}, JSON.stringify(value));
  });

  test('an object passes city and country through', () => {
    assert.deepEqual(locationParts({ city: 'Lisbon', country: 'Portugal' }), { city: 'Lisbon', country: 'Portugal' });
  });

  test('only string parts become keys, so malformed input never yields undefined-valued keys', () => {
    for (const value of [42, true, ['Lisbon', 'Portugal'], {}]) {
      assert.deepEqual(Object.keys(locationParts(value as never)), [], JSON.stringify(value));
    }
    assert.deepEqual(locationParts({ city: 'Lisbon' } as never), { city: 'Lisbon' });
    assert.deepEqual(locationParts({ city: 5, country: 'Portugal' } as never), { country: 'Portugal' });
  });
});
