/**
 * @typedef {Object} PermissionResponse
 * @property {Boolean} result - True if the user has the permission
 * @property {String} reason - The reason for the result
 */

/**
 * [Route].[Endpoint].[Exact(Optional)]
 * It can use * to terminate early AND make all permissions below it true.
 * @param {String} user_permissions 
 * @param {String} required_permission 
 * @returns {PermissionResponse}
 */
const checkPermission = (user_permissions, required_permission) => {
    if (!user_permissions) {
      return { result: false, reason: "Permission not found." };
    }
  
    let hasGeneralPermission = false;
    let specificDenySet = new Set();
  
    for (let perm of user_permissions) {
      // CHeck if the permission is explicitly set
      if (perm === required_permission) {
        return { result: true, reason: perm };
      }
      // Check if a global permission is present
      if (perm === "*") {
        hasGeneralPermission = true;
        continue;
      }
      // Check if the permission is a global permission
      if (perm.endsWith(".*")) {
        let basePerm = perm.slice(0, -2);
        if (required_permission.startsWith(basePerm)) {
          hasGeneralPermission = true;
        }
      }
      // If a .read denial is present, the .write denial is also added
      if (perm.endsWith(".read")) {
        specificDenySet.add(perm.replace(".read", ".write"));
      }
      // If a .write denial is present, the .read denial is also added
      if (perm.endsWith(".write")) {
        specificDenySet.add(perm.replace(".write", ".read"));
      }
    }
  
    if (specificDenySet.has(required_permission)) {
      return { result: false, reason: "Specifically restricted." };
    }
  
    if (hasGeneralPermission) {
      return { result: true, reason: "General permission granted." };
    }
  
    return { result: false, reason: "Not permitted." };
  }