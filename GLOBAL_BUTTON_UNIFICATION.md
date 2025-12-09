# Global Button & Dropdown Unification Complete

## Summary
All buttons and dropdowns across the entire application now use the unified 3D control styling as the single source of truth.

## Global Button Standard (3D Control Style)
```css
height: 32px
padding: 0 12px
font-size: 13px !important
font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif
border-radius: 8px
background: #f2f2f7 (var(--apple-secondary-system-background))

HOVER: 
  background: #e5e5ea (solid, no transparency)
  transform: none (no movement)

ACTIVE:
  background: var(--apple-blue)
  color: #ffffff
  transform: none (no scale)
```

## Files Modified

### 1. apple-design-system.css
- **Global `button` base**: Updated to 32px height, 13px font, solid hover #e5e5ea, blue active
- **.dropdown-button**: Standardized to exact 3D control specs (height 32px, gap 6px, border-radius 8px)
- **.dropdown.open**: Blue background with white text for active state
- **Removed**: Specific dropdown overrides (#actionsDropdown, #levelDropdown, etc.) - now inherit global
- **#visualize-view-grid button**: 32px height, 13px font, solid gray/blue states
- **#visualize-controls button**: 32px height, 13px font, standardized primary/secondary
- **.admin-header button**: 32px height, 13px font, gray background
- **.room-edit-btn**: Removed scale transform on active, kept white bg for canvas visibility
- **All transforms removed**: No translateY, no scale on any button state

### 2. apple-main-menu.css
- **.dropdown-item**: Solid hover #e5e5ea, blue active state

### 3. apple-plan2d.css
- **Removed all overrides**: Plan2D buttons now inherit global styles directly
- No more !important conflicts

### 4. apple-modals.css
- **All modal buttons**: Updated to 32px height, 13px font, 0 16px padding
- **Removed scale transforms**: Changed from `scale(1.02)` to `transform: none` on hover
- **Secondary buttons**: Gray background matching global standard
- **Applied to**: #info-modal, #share-modal, #admin-modal, #visualize-modal, #floorplan-modal, #pricing-modal, #room-palette-modal, #account-modal, #reset-confirmation-modal, .visualize-unsaved-popup, .project-select-popup

### 5. da-workflow-apple.css
- **.da-btn-complete**: 32px height, 13px font, 8px border-radius, gray→blue hover
- **.da-nav-btn**: 32px height, 13px font, removed scale(0.98) transforms
- **.da-nav-btn.back**: Gray background, solid hover, blue active
- **.da-nav-btn.next**: Blue background primary button

## Key Improvements

### Consistency
✅ Every button/dropdown has identical height (32px)
✅ Every button/dropdown uses same font size (13px)
✅ Every button/dropdown uses same border-radius (8px)
✅ Every button/dropdown uses same padding pattern (0 12px or 0 16px)

### No Transparency
✅ All hover states use solid #e5e5ea (no alpha)
✅ --global-hover-bg: #e5e5ea (already fixed in styles.css)

### No Movement
✅ All transform: none on hover and active
✅ No translateY(-1px)
✅ No scale(0.96) or scale(1.02)
✅ Exception: .room-edit-btn keeps translate(-50%, -50%) for centering only

### Active State
✅ Global blue active state (var(--apple-blue) + white text)
✅ Dropdown open state matches active state
✅ Button toggle states use blue for selected

### Special Cases Preserved
- **Room edit buttons**: White background for canvas visibility
- **Primary buttons**: Blue background (visualize controls, nav next, modals)
- **Disabled states**: 0.4 opacity, no hover changes

## Coverage

### Application Areas Unified
1. ✅ 3D Controls (#controls)
2. ✅ 2D Floor Plan (plan2d-tool-btn, menubar buttons)
3. ✅ Dropdowns (all .dropdown-button + .dropdown-item)
4. ✅ Main Menu (#actionsDropdown, #levelDropdown, #debugDropdown, #roof-type-dropdown)
5. ✅ Visualize Controls (#visualize-view-grid, #visualize-controls)
6. ✅ All Modals (info, share, admin, visualize, floorplan, pricing, room palette, account, reset)
7. ✅ DA Workflow (complete button, navigation buttons)
8. ✅ Admin Panel (header buttons, settings actions)
9. ✅ Canvas Overlays (room-edit-btn with no scale)
10. ✅ Global button fallback

### Files Cleaned
- ❌ Removed duplicate Plan2D overrides
- ❌ Removed specific dropdown ID overrides
- ❌ Removed all alpha/transparency on hover
- ❌ Removed all movement transforms
- ❌ Removed varying font sizes (13px everywhere)
- ❌ Removed varying heights (32px everywhere)

## Testing Checklist
- [ ] Load 2D floor plan - verify gray buttons, solid hover, blue active
- [ ] Test dropdowns (Actions, Level, Debug, Roof Type) - verify blue when open
- [ ] Open visualize modal - verify 32px buttons, no scale on hover
- [ ] Test DA workflow - verify nav buttons match global style
- [ ] Test admin panel - verify header buttons 32px
- [ ] Verify no button "bounces" or scales on click anywhere
- [ ] Verify all hover states are solid gray (no transparency)
- [ ] Check dark mode - verify buttons still work correctly

## Result
**Single Source of Truth**: The 3D controls styling (lines 554-613 in apple-design-system.css) now serves as the reference spec that ALL buttons and dropdowns across the entire application follow. No conflicting overrides remain.
