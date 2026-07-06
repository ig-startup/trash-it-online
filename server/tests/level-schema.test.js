const path = require('path');
const level01 = require(path.join(__dirname, '../../client/src/levels/level01.json'));

describe('Level Schema Validation', () => {
  test('level01 has required fields', () => {
    expect(level01).toHaveProperty('id');
    expect(level01).toHaveProperty('widthTiles');
    expect(level01).toHaveProperty('heightTiles');
    expect(level01).toHaveProperty('tileSize');
    expect(level01).toHaveProperty('timeLimit');
    expect(level01).toHaveProperty('spawnPoints');
    expect(level01).toHaveProperty('platforms');
    expect(level01).toHaveProperty('bell');
  });

  test('level01 has at least 2 spawn points', () => {
    expect(Array.isArray(level01.spawnPoints)).toBe(true);
    expect(level01.spawnPoints.length).toBeGreaterThanOrEqual(2);
  });

  test('level01 has exactly one bell', () => {
    expect(level01.bell).toBeDefined();
    expect(typeof level01.bell).toBe('object');
    expect(level01.bell).toHaveProperty('x');
    expect(level01.bell).toHaveProperty('y');
  });

  test('level01 platforms are valid', () => {
    expect(Array.isArray(level01.platforms)).toBe(true);
    expect(level01.platforms.length).toBeGreaterThan(0);
    level01.platforms.forEach((platform, index) => {
      expect(platform).toHaveProperty('x');
      expect(platform).toHaveProperty('y');
      expect(platform).toHaveProperty('width');
      expect(platform).toHaveProperty('height');
    });
  });

  test('level01 destructibles have hp', () => {
    expect(Array.isArray(level01.destructibles)).toBe(true);
    expect(level01.destructibles.length).toBeGreaterThan(0);
    level01.destructibles.forEach((obj, index) => {
      expect(obj).toHaveProperty('hp');
      expect(obj.hp).toBeGreaterThan(0);
    });
  });
});
