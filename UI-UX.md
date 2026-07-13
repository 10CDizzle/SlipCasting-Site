Here is a comprehensive UI/UX guide to Onshape, detailing its layout, terminology, and interaction paradigms based on its cloud-native architecture.

# Comprehensive UI/UX Guide to Onshape

Onshape’s user interface is built around a modern, cloud-native paradigm. Unlike legacy desktop CAD software, Onshape runs entirely in a web browser or mobile app. This eliminates the need for software installations and file saving, heavily influencing its UI layout, which prioritizes real-time collaboration, integrated data management, and a clean, contextual workspace.

---

## 1. The Documents Page (Dashboard)

When you log into Onshape, you are greeted by the Documents page. This serves as your primary file management dashboard.

* **Main Navigation (Left Sidebar):** Filters your view to show *Recently Opened*, *Created by Me*, *Shared with Me*, *Public*, and *Trash*.
* **List/Grid View (Center):** Displays your documents and folders. Onshape uses "Documents" not as single files, but as project-level containers that hold multiple tabs of different data types (parts, assemblies, drawings, and PDFs).
* **Search Bar (Top):** Allows for robust searching across all metadata, part names, and document titles.
* **Create Button (Top Left):** The primary call-to-action for generating new Documents, Folders, or importing files.

---

## 2. The Document Workspace (The Core UI)

Once you open a Document, you enter the Document Workspace. The layout is divided into distinct zones designed to maximize the 3D graphics area while keeping tools easily accessible.

### A. The Top Toolbar (Context-Sensitive Ribbon)

The top toolbar dynamically changes based on the active tab and your current state (e.g., whether you are actively editing a sketch or applying a 3D feature).

* **Document Menu (Document Name):** Click the document name to access document-wide settings, workspace units, workspace properties, and version history.
* **Version and History Graph:** A branching visual tree that acts as built-in Product Data Management (PDM). It allows users to create versions, branch designs, and merge changes without leaving the UI.
* **Contextual Tool Sets:**
* **Sketch Mode:** Displays 2D geometry tools (Lines, Circles, Dimensions, Constraints).
* **Part Studio (Feature Mode):** Displays 3D creation and modification tools (Extrude, Revolve, Fillet, Boolean).
* **Assembly Mode:** Displays mating tools (Fastened Mate, Revolute Mate) and Bill of Materials (BOM) options.


* **Share Button (Top Right):** Allows you to invite collaborators, set permissions (View, Edit, Comment), and generate secure links.

### B. The Left Panel: Feature Tree and Parts List

Located on the left side of the workspace, this panel tracks the chronological history and the physical bodies of your design.

| Section | Description |
| --- | --- |
| **Feature List (Top)** | A chronological, parametric list of every sketch and 3D feature used to create the model. You can drag features up or down to change the order of operations. |
| **The Rollback Bar** | A horizontal bar inside the Feature List. Dragging it upward temporarily "rolls back" the model in time, hiding features below the bar so you can insert new features at an earlier stage. |
| **Parts List (Bottom)** | A categorical list of generated geometry. It is divided into Solid Parts, Surfaces, Curves, Meshes, and Composite Parts. Hovering over a part reveals an eyeball icon to toggle visibility (Hide/Show). |

### C. The Graphics Area (Center Viewport)

This is the infinite 3D space where your modeling takes place. It provides real-time rendering of your sketches, parts, and assemblies.

* **Additive Selection:** A core Onshape UX paradigm. Unlike some software where clicking a new entity deselects the previous one, Onshape uses *additive selection*. Clicking multiple faces or edges adds them all to the selection pool. To clear a selection, click an empty space in the Graphics Area or press the **Spacebar**.
* **Context Menus:** Right-clicking anywhere in the Graphics Area brings up a context-sensitive menu to isolate parts, export geometry, or edit a specific feature.

### D. View Cube and Navigation (Top Right of Graphics Area)

Onshape provides a standard interactive cube for spatial orientation.

* **View Cube:** Clicking faces, edges, or corners of the cube snaps the camera to standard orthographic or isometric views.
* **View Options Dropdown:** A small cube icon beneath the main View Cube. It houses display styles (Shaded, Shaded with Edges, Hidden Edges Visible, Translucent) and camera settings (Perspective vs. Orthographic).

### E. The Tabs Manager (Bottom of Screen)

Because an Onshape Document is a container, the bottom of the screen functions similarly to a web browser's tab system.

* **Tab Types:** You can have multiple tabs open for *Part Studios* (where individual or multi-body parts are made), *Assemblies* (where parts are put together), *Drawings* (2D manufacturing prints), and custom imported files (like a reference PDF or image).
* **Tab Manager (+ Icon):** Used to create new tabs of any type within the current document.

### F. The Right-Side Panels (Slide-Outs)

Running vertically along the right edge of the screen are collapsible panels used for secondary metadata and customization.

* **Appearance Panel:** Used to apply custom colors and optical properties to specific parts or faces.
* **Configuration Panel:** Used to create design variations (e.g., changing lengths or hole sizes via a variable table) without building an entirely new file.
* **Custom Tables:** Often used for advanced routing or sheet metal tables.

### G. The Bottom-Right: Properties and Measurement

Onshape streamlines UX by automating measurements. You do not always need to click a specific "Measure" tool.

* **Auto-Measure:** Simply click an edge, face, or multiple entities, and the measurement data (length, radius, angle, distance) instantly appears in the bottom right corner of the screen.
* **Mass Properties:** Clicking the scale icon in this corner opens the mass properties dialog, which calculates volume, surface area, and center of mass based on assigned materials.

---

## 4. Key UX Interaction Paradigms

* **The "S" Key Shortcut Menu:** Pressing the `S` key opens a floating shortcut toolbar right next to your mouse cursor. This menu is completely customizable and changes contextually depending on whether you are in a Sketch, Part Studio, or Assembly.
* **Dialog Box Navigation:** When a feature dialog opens (e.g., Extrude), the primary input field is highlighted in blue, waiting for a visual selection from the Graphics Area. The first text field is white, waiting for numeric input. Users can navigate smoothly through these dialogs using the `Tab` key to move between fields and the `Enter` key to confirm the feature.
* **Preview Slider:** Many feature dialogs feature a preview slider, allowing the user to seamlessly visualize the addition or removal of material before committing to the action.

---

## 5. Mobile Interface UX

Because Onshape is cloud-native, the full application is available on iOS and Android. The mobile UX is carefully adapted for touch:

* **Gestures:** Two-finger drag to pan, pinch to zoom, and single-finger drag to rotate.
* **Crosshairs:** For precise selection on small screens, holding a finger down brings up a magnifying crosshair to ensure the correct edge or vertex is selected.
* **Adaptive Toolbars:** Tools are grouped into expandable, touch-friendly icons at the top of the screen, ensuring the Graphics Area remains as unobstructed as possible.