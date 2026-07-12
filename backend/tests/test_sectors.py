from app.services.kr_universe import KR_UNIVERSE
from app.services.screener import US_UNIVERSE
from app.services.sectors import KR_SECTORS, US_SECTORS


def _flatten(sectors: dict[str, list[str]]) -> list[str]:
    return [s for members in sectors.values() for s in members]


def test_kr_sectors_cover_universe_exactly_once():
    flat = _flatten(KR_SECTORS)
    assert len(flat) == len(set(flat)), "중복 배정된 종목이 있음"
    assert set(flat) == set(KR_UNIVERSE), (
        f"누락: {set(KR_UNIVERSE) - set(flat)}, 유니버스 밖: {set(flat) - set(KR_UNIVERSE)}"
    )


def test_us_sectors_cover_universe_exactly_once():
    flat = _flatten(US_SECTORS)
    assert len(flat) == len(set(flat)), "중복 배정된 종목이 있음"
    assert set(flat) == set(US_UNIVERSE), (
        f"누락: {set(US_UNIVERSE) - set(flat)}, 유니버스 밖: {set(flat) - set(US_UNIVERSE)}"
    )


def test_sector_counts():
    assert len(KR_SECTORS) == 20
    assert len(US_SECTORS) == 20
