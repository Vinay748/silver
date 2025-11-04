const fs = require('fs');
const path = require('path');

/**
 * Load JSON data from a file
 * @param {string} filePath - Path to the JSON file
 * @returns {any} Parsed JSON data
 */
function loadJSON(filePath) {
  try {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
      console.log(`[FILE] File not found: ${absolutePath}, returning empty object`);
      return {};
    }
    const data = fs.readFileSync(absolutePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`[FILE] Error loading JSON from ${filePath}:`, error.message);
    return {};
  }
}

/**
 * Save JSON data to a file
 * @param {string} filePath - Path to the JSON file
 * @param {any} data - Data to save
 */
function saveJSON(filePath, data) {
  try {
    const absolutePath = path.resolve(filePath);
    const dir = path.dirname(absolutePath);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[FILE] Created directory: ${dir}`);
    }
    
    fs.writeFileSync(absolutePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[FILE] Saved JSON to ${filePath}`);
  } catch (error) {
    console.error(`[FILE] Error saving JSON to ${filePath}:`, error.message);
    throw error;
  }
}

/**
 * Load employee users from parent project
 * @returns {Array} Array of employee objects
 */
function loadEmployeeUsers() {
  try {
    const usersPath = path.join(__dirname, '../../data/users.json');
    const data = loadJSON(usersPath);
    console.log(`[FILE] Loaded ${Array.isArray(data) ? data.length : 0} employees from parent project`);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[FILE] Error loading employee users:', error.message);
    return [];
  }
}

module.exports = {
  loadJSON,
  saveJSON,
  loadEmployeeUsers
};
