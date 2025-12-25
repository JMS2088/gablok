# Project Design System - User Guide

## Overview

The project system now allows you to **save your complete 3D and 2D designs** to projects, along with AI-generated visualizations. This means you can work on multiple building designs and switch between them easily.

## What Gets Saved in a Project?

When you save a design to a project, it includes:

### 3D Design Data
- ✅ **All rooms** (walls, dimensions, layout)
- ✅ **Wall strips** (standalone walls)
- ✅ **Stairs** (all stair components)
- ✅ **Pergolas**
- ✅ **Garages**
- ✅ **Pools**
- ✅ **Roofs**
- ✅ **Balconies**
- ✅ **Furniture** (beds, kitchens, tables, etc.)
- ✅ **Camera position** (your current view)
- ✅ **Current floor** (ground or first floor)

### 2D Plan Data
- ✅ **Floor plan elements** for both floors
- ✅ **Measurement guides** (vertical and horizontal)
- ✅ **View settings** (zoom, pan position)
- ✅ **User edits** flag

### Visualizations
- ✅ **AI-generated images** from the photoreal panel
- ✅ **Image URLs** for all renders

## How to Use

### Creating a New Project

1. **Open Account Modal**
   - Click the account icon (👤) in top-right corner
   - Go to **"Projects"** tab

2. **Click "New Project"**
   - Enter a project name
   - You'll be asked: **"Save current 3D/2D design to this project?"**
     - Click **OK** to save your current workspace
     - Click **Cancel** to create an empty project

3. **Project is created!**
   - Shows in your projects list
   - If you saved the design, you'll see a **📐 Design** badge

### Saving Design to Existing Project

1. **Open Projects Tab** in account modal

2. **Find the project** you want to save to

3. **Click "💾 Save"** button
   - Current workspace (3D + 2D) is saved to that project
   - You'll see a status message: "Design saved to: [Project Name]"
   - Project card updates to show **📐 Design** badge

4. **That's it!** Your design is safely stored

### Loading a Project

1. **Open Projects Tab** in account modal

2. **Find the project** you want to load

3. **Click "📂 Load"** button
   - You'll see a confirmation dialog:
     ```
     Load project "My House Design"?
     
     This will replace your current workspace.
     
     Make sure you've saved any changes first!
     ```

4. **Click OK** to load
   - Your entire workspace is replaced
   - All 3D rooms, 2D plans, and settings are restored
   - Account modal closes automatically
   - You'll see: "Loaded project: [Project Name]"

5. **Start working** on the loaded design!

### Understanding Project Cards

Each project card shows:

```
┌─────────────────────────────────────┐
│ 📁 My Dream Home                    │
│ December 5, 2024                    │
│ [📐 Design] [3 AI]                  │ ← Badges
│ [thumbnail images if available]     │
│                                     │
│ [🏗️ DA] [💾 Save] [📂 Load] [🗑️]  │ ← Actions
└─────────────────────────────────────┘
```

#### Badges:
- **📐 Design** - Project has saved 3D/2D design data
- **X AI** - Project has X AI-generated images

#### Action Buttons:
- **🏗️ DA** - Open DA Approval Workflow
- **💾 Save** - Save current workspace to this project
- **📂 Load** - Load this project's design into workspace
- **🗑️** - Delete project (permanent!)

### Deleting a Project

1. **Click the 🗑️ button** on project card

2. **Confirm deletion**
   ```
   Delete project "My House Design"?
   This cannot be undone.
   ```

3. **Click OK** to permanently delete

⚠️ **Warning:** Deleted projects cannot be recovered!

## Workflow Examples

### Starting a New Design

1. Create new project with current empty workspace
2. Design your building in 3D
3. Create floor plans in 2D
4. Generate AI visualizations
5. Click **💾 Save** to store everything

### Working on Multiple Projects

**Scenario:** You're designing 3 different houses

1. **Morning:** Load "Beach House" project
   - Click 📂 Load
   - Work on beach house design
   - Click 💾 Save when done

2. **Afternoon:** Load "City Apartment" project
   - Click 📂 Load
   - Work on apartment design
   - Click 💾 Save when done

3. **Evening:** Load "Country Estate" project
   - Click 📂 Load
   - Work on estate design
   - Click 💾 Save when done

All three projects are kept separate!

### Sharing Projects via DA Workflow

1. Create and save your design
2. Generate AI visualizations
3. Click **🏗️ DA** to open DA workflow
4. Work through approval steps
5. Share project link with professionals
6. They can see your design + DA progress

## Tips & Best Practices

### Save Often
✅ **Click 💾 Save frequently** as you make changes
- Design data is stored in project
- No risk of losing work
- Can always load back

### Before Loading
⚠️ **Always save current work before loading another project**
- Loading replaces your entire workspace
- Unsaved changes will be lost
- Confirmation dialog reminds you

### Organize Projects
📁 **Use descriptive names**
- Good: "Smith Residence - 3 Bedroom"
- Bad: "Project 1"

### Delete Old Projects
🗑️ **Clean up projects you don't need**
- Keeps project list manageable
- Frees up browser storage space

### Backup Important Projects
💾 **For critical projects:**
1. Save design to project
2. Generate AI renders (stored automatically)
3. Use DA workflow for documentation
4. Consider browser backup/sync

## Technical Details

### Storage Location
- **LocalStorage** in your browser
- Key: `gablok_projects_<userId>`
- Projects are per-user account

### Data Size
- **3D/2D Design:** ~50-200KB per project
- **AI Images:** ~100-500KB each
- **Total:** Typically 500KB - 5MB per project
- **Browser limit:** ~5-10MB total for all projects

### What Happens When You Load
1. Current workspace is cleared
2. Project data is parsed
3. All entities are restored:
   - Rooms created
   - Walls rebuilt
   - Components placed
   - Camera repositioned
4. 2D plans are loaded
5. AI images are linked
6. Current project ID is tracked globally

### Compatibility
- ✅ **Cross-session:** Projects persist between sessions
- ✅ **Cross-device:** Use same browser account
- ❌ **Cross-browser:** Projects don't sync between different browsers
- ❌ **Offline sync:** No cloud backup (localStorage only)

## Troubleshooting

### "Failed to load project design"
**Cause:** Project data is corrupted or missing
**Solution:** 
- Check browser console for errors
- Try creating a new project
- Contact support if persistent

### "This project has no saved design data"
**Cause:** Project was created empty or design wasn't saved
**Solution:**
- Create design in workspace
- Click **💾 Save** on that project
- Design badge will appear

### Projects disappeared
**Cause:** Browser data was cleared
**Solution:**
- Projects are stored in localStorage
- If cleared, they cannot be recovered
- Important: Regularly save and backup

### Can't see updated changes after saving
**Cause:** Browser cache issue
**Solution:**
- Refresh the projects view
- Close and reopen account modal
- Hard refresh browser (Ctrl+Shift+R)

## Keyboard Shortcuts

Currently, project management is mouse/touch-based.

**Future enhancement:** Quick save shortcuts like:
- `Ctrl+S` - Save to current project
- `Ctrl+O` - Open project selector
- `Ctrl+Shift+S` - Save as new project

## Related Features

### AI Visualizations
- Generate renders in photoreal panel
- Save images to project automatically
- Load project to see all its renders

### DA Workflow
- Each project has its own DA workflow state
- Track approval progress per project
- Share project with professionals

### 2D/3D Sync
- 2D and 3D are always in sync
- Saving design captures both
- Loading restores both simultaneously

---

## Quick Reference

| Action | Button | Result |
|--------|--------|--------|
| Create project | "New Project" | New project added |
| Save design | 💾 Save | Current workspace → project |
| Load design | 📂 Load | Project → workspace |
| Delete project | 🗑️ Delete | Project removed permanently |
| Open DA workflow | 🏗️ DA | DA workflow for project |

---

**Need help?** Check the main project documentation or contact support.

**Pro Tip:** Save your designs frequently to different projects as you iterate. You can always go back to previous versions!

