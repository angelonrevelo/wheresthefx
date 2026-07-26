import { describe, expect, it } from 'vitest';
import { bestName, classifyPair, metreApart, nameScore, venueHead } from './venueMerge.js';

/**
 * Every pair here is a real one from the venue directory.
 *
 * The stakes are asymmetric in the opposite direction from event dedup:
 * a missed venue merge shows two pins a few metres apart, which is
 * untidy. A wrong one deletes a row and repoints its events at a
 * different place, which puts events at an address they are not at.
 */

let nextId = 1;
function row(name: string, lat: number | null = 14.5, lng: number | null = 121.0) {
  return { venueId: nextId++, name, alias: null, lat, lng };
}

describe('metreApart', () => {
  it('measures the Homebase pair that must never merge', () => {
    const tondo = row('Homebase', 14.6135, 120.9634);
    const makati = row('HOMEBASE', 14.5663, 121.0308);
    expect(metreApart(tondo, makati)).toBeGreaterThan(8000);
  });

  it('returns null when either row lacks a coordinate', () => {
    expect(metreApart(row('A', null, null), row('B'))).toBeNull();
  });
});

describe('classifyPair — distance overrides the name', () => {
  it('refuses two Homebases 9km apart despite the identical name', () => {
    // One is on Maya-Maya St in Tondo, the other on B. Valdez in Makati.
    const tondo = row('Homebase', 14.6135, 120.9634);
    const makati = row('HOMEBASE', 14.5663, 121.0308);
    expect(classifyPair(tondo, makati)).toBe('different');
  });

  it('merges an identical name at the same coordinate', () => {
    expect(classifyPair(row('SinePop', 14.6235, 121.0518), row('Sinepop', 14.6235, 121.0518)))
      .toBe('same');
  });
});

describe('classifyPair — spelling and case variants', () => {
  const at = (name: string) => row(name, 14.5998, 121.0302);

  it('folds the six spellings of A. Bodespace together', () => {
    const canonical = at('A. Bodespace');
    for (const variant of ['a.bode space', 'A.bode Space', 'a.bodespace', 'a bode space', 'A.BODESPACE']) {
      expect(classifyPair(canonical, at(variant)), variant).toBe('same');
    }
  });

  it('folds a smart quote and an ampersand variant together', () => {
    expect(classifyPair(row("Jess & Pat's"), row('Jess and Pat’s'))).toBe('same');
    expect(classifyPair(row('Bumi & Ashe Studio'), row('bumi & ashe studio'))).toBe('same');
    expect(classifyPair(row('xin chào'), row('Xin Chào'))).toBe('same');
  });
});

describe('classifyPair — a trailing address is not a different venue', () => {
  const at = (name: string) => row(name, 14.6371, 121.0730);

  it('folds the four spellings of 47 East together', () => {
    const base = at('47 East');
    for (const variant of [
      '47 East, Esteban Abada Street, Katipunan',
      '47 East, Esteban Abada, Katipunan',
      '47 East Katipunan',
    ]) {
      expect(classifyPair(base, at(variant)), variant).toBe('same');
    }
  });

  it('folds a venue carrying the property it sits in', () => {
    const okada = (n: string) => row(n, 14.5136, 120.9814);
    expect(classifyPair(okada('The Fountain'), okada('The Fountain, Okada Manila'))).toBe('same');
  });
});

describe('classifyPair — the cases that must not auto-merge', () => {
  it('holds a tenant inside a larger venue for review', () => {
    // Greyhound Cafe is a restaurant inside Ayala Triangle Gardens, 100m
    // away. Folding it in silently drops the more precise label, so a
    // person decides rather than the script.
    const cafe = row('Greyhound Cafe, Ayala Triangle Gardens', 14.5561, 121.0242);
    const garden = row('Ayala Triangle Gardens', 14.5571, 121.0245);
    expect(classifyPair(cafe, garden)).toBe('review');
  });

  it('holds two adjacent buildings named together for review', () => {
    // WTC and SMX are neighbours, and extraction returned both as one
    // string. They are not the same building.
    const both = row('World Trade Center Metro Manila and SMX Convention Center Manila', 14.5321, 120.9817);
    const smx = row('SMX Convention Center Manila', 14.5321, 120.9817);
    expect(classifyPair(both, smx)).toBe('review');
  });

  it('never merges differently named rows without coordinates', () => {
    expect(classifyPair(row('The Fountain', null, null), row('The Fountain, Okada Manila', null, null)))
      .toBe('different');
  });
});

describe('venueHead', () => {
  it('drops everything after the first comma', () => {
    expect(venueHead('47 East, Esteban Abada, Katipunan')).toBe('47 east');
    expect(venueHead('The Corner House, San Juan City')).toBe('the corner house');
  });

  it('leaves a name with no comma alone', () => {
    expect(venueHead('SM Mall of Asia Arena')).toBe('sm mall of asia arena');
  });
});

describe('nameScore and bestName — what the public sees', () => {
  it('prefers mixed case over shouting or whispering', () => {
    expect(nameScore('A. Bodespace')).toBeGreaterThan(nameScore('A.BODESPACE'));
    expect(nameScore('Bumi & Ashe Studio')).toBeGreaterThan(nameScore('bumi & ashe studio'));
    expect(nameScore('Xin Chào')).toBeGreaterThan(nameScore('xin chào'));
  });

  it('prefers a name without an address bolted on', () => {
    expect(nameScore('47 East')).toBeGreaterThan(nameScore('47 East, Esteban Abada, Katipunan'));
  });

  it('prefers a real name over a handle', () => {
    expect(nameScore('The Funroof')).toBeGreaterThan(nameScore('the_funroof'));
  });

  it('picks the presentable name out of each real cluster', () => {
    expect(bestName([
      row('a.bode space'), row('A.bode Space'), row('a.bodespace'),
      row('a bode space'), row('A.bode'), row('A.BODESPACE'), row('A. Bodespace'),
    ])).toBe('A. Bodespace');

    expect(bestName([
      row('47 East'), row('47 East, Esteban Abada Street, Katipunan'),
      row('47 East, Esteban Abada, Katipunan'), row('47 East Katipunan'),
    ])).toBe('47 East');

    expect(bestName([
      row('the_funroof'), row('fun roof @the_funroof poblacion'),
      row('The Funroof'), row('Funroof Poblacion'),
    ])).toBe('The Funroof');

    expect(bestName([row('Under The Victor Podium, Bridgetowne, Pasig'), row('Under The Victor Podium')]))
      .toBe('Under The Victor Podium');
  });
});

describe('classifyPair — co-location alone is not a signal', () => {
  it('ignores unrelated neighbours in the same bar strip', () => {
    // Poblacion and the malls put a dozen unrelated venues inside 150m.
    // Flagging on distance alone produced sixty pairs of pure noise.
    const pair: [string, string][] = [
      ['Kampai', 'Ono Kai'],
      ['Lots of Local', 'YL Holdings Building'],
      ['Art Fair Philippines', 'Circuit Corporate Center One'],
      ['HOMEBASE', 'Freshly Cooked'],
      ['Mood Coffee', "Jess and Pat's"],
    ];
    for (const [a, b] of pair) {
      expect(classifyPair(row(a), row(b)), `${a} / ${b}`).toBe('different');
    }
  });

  it('still surfaces a neighbour whose name genuinely overlaps', () => {
    expect(classifyPair(row('Roppongi 128'), row('Roppongi'))).toBe('review');
    expect(classifyPair(row('TagoJazz'), row('Tago Jazz Bar'))).toBe('review');
  });
});

describe('classifyPair — a room is not the building', () => {
  it('refuses to fold a mall into its own activity center', () => {
    // The first dry run renamed "Ayala Malls Circuit" to "Ayala Malls
    // Circuit Activity Center" — the mall taking the name of one of its
    // rooms, which is the mistake the extraction prompt guards from the
    // other direction.
    const mall = row('Ayala Malls Circuit');
    for (const room of ['Activity Center, Ayala Malls Circuit', 'Ayala Malls Circuit, Activity Center']) {
      expect(classifyPair(mall, row(room)), room).toBe('review');
    }
    expect(classifyPair(row('Ayala Malls Vertis North'), row('Atrium, Ayala Malls Vertis North')))
      .toBe('review');
  });

  it('still merges two spellings of the same room', () => {
    expect(classifyPair(row('Palm Drive Activity Center'), row('Palm Drive Activity Center, Glorietta')))
      .toBe('same');
    expect(classifyPair(
      row('Under The Victor Podium'),
      row('Under The Victor Podium, Bridgetowne, Pasig'),
    )).toBe('same');
  });
});
