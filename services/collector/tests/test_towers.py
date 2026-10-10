"""Which tower picture a world-map base level gets (gamedata/towers.py)."""

from dw_collector.gamedata.towers import level_tiers, tier_pieces


def test_level_tiers_reads_the_tier_out_of_the_model_name() -> None:
    models = {
        1: "building_400001_world",
        4: "building_400005_world",
        40: "building_400031_world",
    }
    assert level_tiers(models) == {1: 1, 4: 5, 40: 31}


def test_level_tiers_drops_models_that_are_not_a_plain_world_tower() -> None:
    models = {
        1: "building_400001_world",
        2: "building_400002_world_s6",
        3: "building_400003_world_dragon",
        4: "icon_zone_base_1",
    }
    assert level_tiers(models) == {1: 1}


def test_tier_pieces_is_one_mesh_for_a_plain_tier() -> None:
    assert tier_pieces(5) == [("A_build_daben_05", "A_build_daben_05_day_D")]


def test_tier_pieces_stacks_the_parts_of_a_tall_tier() -> None:
    assert tier_pieces(12) == [
        ("A_build_daben_12_xia", "A_build_daben_12_xia_day_D"),
        ("A_build_daben_12_zhong", "A_build_daben_12_zhong_day_D"),
        ("A_build_daben_12_shang", "A_build_daben_12_shang_day_D"),
    ]


def test_truck_sprites_cover_five_qualities_by_eight_headings() -> None:
    from dw_collector.gamedata.trucks import truck_ref, truck_sprites

    rows = list(truck_sprites())
    assert len(rows) == 40
    assert (4, 2, "truck_lod_purple2") in rows
    assert truck_ref(5, 7) == "5-7"
