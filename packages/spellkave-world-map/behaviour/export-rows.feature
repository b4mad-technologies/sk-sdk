@persona:map-developer
Feature: Export a world from its table rows
  As a developer of the tile gateway I want to export a world from the rows a
  live world holds (a rows.json file instead of a bundle), so that what the
  world says about a place, a path or a fight shows on the map as OSM tags.

  @code:src/poi.ts:parsePoiMetadata
  Scenario: A point of interest keeps its icon, category, badge and colour
    A `maps.poi` metadata attachment on a place (ADR-0073, ADR-0130) becomes
    tags the map style draws.
    Given the rows file "rows.json":
      """json
      {
        "place_graphs": [{ "place_graph_id": "world", "origin_cell_res10": "622215095455449087", "anchor_node_id": "world/square", "substrate_id": "outdoor", "metres_per_unit": 1 }],
        "place_nodes": [
          { "node_id": "world/square", "place_graph_id": "world", "pos_present": true, "pos_x": 0, "pos_y": 0, "substrate_id": "outdoor", "display_name": "Hamlet Square" },
          { "node_id": "world/tavern", "place_graph_id": "world", "pos_present": true, "pos_x": 10, "pos_y": 10, "substrate_id": "outdoor", "display_name": "The Drunken Dragon" }
        ],
        "metadata_attachments": [
          { "target_kind": "place_node", "target_ref": "world/tavern", "namespace": "maps.poi", "payload_json": "{\"icon\":\"inn\",\"category\":\"hospitality\",\"badge\":\"Inn\",\"color\":\"#f59e0b\"}" }
        ]
      }
      """
    When I run "world-map export rows.json --json map.json"
    Then world-map succeeds
    And in "map.json" the node "world/tavern" has the tags:
      | spellkave:poi_icon     | inn         |
      | spellkave:poi_category | hospitality |
      | spellkave:poi_badge    | Inn         |
      | spellkave:poi_color    | #f59e0b     |

  @code:src/export.ts:exportWorld
  Scenario: A flight path and a sealed door keep how they are crossed
    An edge affordance names the movement mode a path needs (ADR-0101); a
    seal affordance whose open state is false makes the path a locked gate.
    Given the rows file "rows.json":
      """json
      {
        "place_graphs": [{ "place_graph_id": "world", "origin_cell_res10": "622215095455449087", "anchor_node_id": "world/cliff", "substrate_id": "outdoor", "metres_per_unit": 1 }],
        "place_nodes": [
          { "node_id": "world/cliff", "place_graph_id": "world", "pos_present": true, "pos_x": 0, "pos_y": 0, "substrate_id": "outdoor" },
          { "node_id": "world/peak", "place_graph_id": "world", "pos_present": true, "pos_x": 10, "pos_y": 10, "substrate_id": "outdoor" },
          { "node_id": "world/vault", "place_graph_id": "world", "pos_present": true, "pos_x": 0, "pos_y": 5, "substrate_id": "outdoor" }
        ],
        "place_edges": [
          { "edge_id": 10, "edge_key": "world/cliff->world/peak", "place_graph_id": "world", "from_node_id": "world/cliff", "to_node_id": "world/peak" },
          { "edge_id": 20, "edge_key": "world/cliff->world/vault", "place_graph_id": "world", "from_node_id": "world/cliff", "to_node_id": "world/vault" }
        ],
        "place_edge_affordances": [
          { "edge_key": "world/cliff->world/peak", "mode_id": "fly", "affordance_template_id": "srd/affordance/fly" },
          { "edge_key": "world/cliff->world/vault", "mode_id": "", "affordance_template_id": "mod/affordance/ironfold_seal" }
        ],
        "edge_states": [{ "edge_id": "20", "state_id": "mod/ironfold_seal_open", "value": false }]
      }
      """
    When I run "world-map export rows.json --json map.json"
    Then world-map succeeds
    And in "map.json" the way "world/cliff->world/peak" has the tags:
      | spellkave:traversal_mode | fly         |
      | spellkave:from_node      | world/cliff |
      | spellkave:to_node        | world/peak  |
    And in "map.json" the way "world/cliff->world/vault" has the tags:
      | barrier         | gate                         |
      | spellkave:seal  | mod/affordance/ironfold_seal |
      | spellkave:locked | yes                         |

  @code:src/export.ts:exportWorld
  Scenario Outline: <place> marks both the place and its outline
    A niche, a name or a node state tells the export what kind of ground a
    place is (sk-jay0.4.12); the tags land on the place's node and on its
    extent outline alike.
    Given the rows file "rows.json":
      """json
      {
        "place_graphs": [{ "place_graph_id": "world", "origin_cell_res10": "622215095455449087", "anchor_node_id": "world/pool", "substrate_id": "indoor", "metres_per_unit": 1 }],
        "place_nodes": [
          { "node_id": "world/pool", "place_graph_id": "world", "display_name": "Stagnant Slime Pool", "extent_shape_id": "core/area/cube", "extent_params_json": "{\"extent_m\":10}", "pos_present": true, "pos_x": 0, "pos_y": 0 },
          { "node_id": "world/river", "place_graph_id": "world", "display_name": "River Bank", "extent_shape_id": "core/area/cube", "extent_params_json": "{\"extent_m\":8}", "pos_present": true, "pos_x": 10, "pos_y": 0 },
          { "node_id": "world/rubble", "place_graph_id": "world", "display_name": "Rubble Room", "extent_shape_id": "core/area/cube", "extent_params_json": "{\"extent_m\":6}", "pos_present": true, "pos_x": 20, "pos_y": 0 }
        ],
        "place_edges": [],
        "spatial_niche_attachments": [{ "place_node_id": "world/pool", "niche_id": "kavemouth/niche/hazard_pool" }],
        "niche_definitions": [{ "niche_id": "kavemouth/niche/hazard_pool", "display_name": "Slime Pool Hazard" }],
        "node_states": [{ "node_id": "world/rubble", "state_id": "srd/state/difficult_terrain", "value": 2 }]
      }
      """
    When I run "world-map export rows.json --json map.json"
    Then world-map succeeds
    And in "map.json" the node "<node>" and its extent both have "<tags>"

    Examples:
      | place                         | node         | tags                                          |
      | a slime pool hazard niche     | world/pool   | spellkave:hazard=slime hazard=yes natural=water |
      | a river bank                  | world/river  | natural=water water=river                     |
      | a room of difficult terrain   | world/rubble | spellkave:terrain=difficult                   |

  @code:src/export.ts:exportWorld
  Scenario: A combat grid is exported on its anchor's floor
    A tactical session grid (an ephemeral graph under a dungeon) is not
    dropped: its cells and edges are tagged tactical, and its cells adopt the
    elevation and level of the room the fight happens in.
    Given the rows file "rows.json":
      """json
      {
        "place_graphs": [
          { "place_graph_id": "dungeon", "origin_cell_res10": "622215095455449087", "anchor_node_id": "dungeon/entry", "substrate_id": "indoor", "metres_per_unit": 1 },
          { "place_graph_id": "session_grid_1", "parent_graph_id": "dungeon", "anchor_node_id": "dungeon/arena", "substrate_id": "tactical", "metres_per_unit": 1.5, "is_ephemeral_instance": true }
        ],
        "place_nodes": [
          { "node_id": "dungeon/entry", "place_graph_id": "dungeon", "pos_present": true, "pos_x": 0, "pos_y": 0, "substrate_id": "indoor" },
          { "node_id": "dungeon/arena", "place_graph_id": "dungeon", "pos_present": true, "pos_x": 5, "pos_y": 5, "pose_elevation_present": true, "pose_elevation": -3, "substrate_id": "indoor" },
          { "node_id": "session_grid_1/c_0_0", "place_graph_id": "session_grid_1", "pos_present": true, "pos_x": 0, "pos_y": 0, "substrate_id": "tactical", "is_ephemeral": true },
          { "node_id": "session_grid_1/c_1_0", "place_graph_id": "session_grid_1", "pos_present": true, "pos_x": 1, "pos_y": 0, "substrate_id": "tactical", "is_ephemeral": true }
        ],
        "place_edges": [
          { "edge_key": "dungeon/entry->arena", "place_graph_id": "dungeon", "from_node_id": "dungeon/entry", "to_node_id": "dungeon/arena" },
          { "edge_key": "session_grid_1/edge/0-1", "place_graph_id": "session_grid_1", "from_node_id": "session_grid_1/c_0_0", "to_node_id": "session_grid_1/c_1_0" }
        ]
      }
      """
    When I run "world-map export rows.json --json map.json"
    Then world-map succeeds
    And in "map.json" the node "session_grid_1/c_0_0" has the tags:
      | spellkave:substrate   | tactical |
      | spellkave:tactical    | cell     |
      | spellkave:elevation_m | -3       |
      | level                 | -1       |
    And in "map.json" the way "session_grid_1/edge/0-1" has the tags:
      | spellkave:tactical | edge |

  @code:src/coords.ts:projectWorld
  Scenario: An outdoor place without a position lands on its cell's centre
    Without substrate definitions the export also says it used the kernel's
    bootstrap kinds (outdoor is an H3 cell, indoor a local graph).
    Given the rows file "rows.json":
      """json
      {
        "place_graphs": [{ "place_graph_id": "root", "parent_graph_id": "", "anchor_node_id": "a", "substrate_id": "outdoor", "bearing": 0, "metres_per_unit": 1, "origin_cell_res10": "622215095455449087", "bundle_id": "b" }],
        "place_nodes": [
          { "node_id": "a", "place_graph_id": "root", "bundle_id": "b", "substrate_id": "outdoor", "pos_present": true, "pos_x": 0, "pos_y": 0, "cell_res10": "622215095455449087" },
          { "node_id": "centroid_only", "place_graph_id": "root", "bundle_id": "b", "substrate_id": "outdoor", "pos_present": false, "cell_res10": "622215095455449087" }
        ],
        "place_edges": []
      }
      """
    When I run "world-map export rows.json --json map.json"
    Then world-map succeeds
    And in "map.json" the node "centroid_only" lies in H3 cell "622215095455449087"
    And the summary's diagnostics mention "substrate_kind_fallback"
