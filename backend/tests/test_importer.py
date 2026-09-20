import io

from app.importer.csv_parser import parse_csv


def test_csv_parser_ignores_office_footer_and_normalizes_request():
    csv = """ID;BK;HD;region_id;Начало;Окончание;Адрес;Широта;Долгота
1;Подключение;;zone_1;09:00;12:00;ул. Тестовая, 1;55.75;37.61
;Адрес офиса;;;;Москва;;
"""
    data = parse_csv(io.StringIO(csv))
    assert len(data.requests) == 1
    assert data.requests[0].id == 1
    assert data.requests[0].window_start == 540
    assert data.requests[0].region_id == "zone_1"
