def test_cpp_solver_returns_verified_candidate_shape():
    import os
    import sys
    from pathlib import Path
    os.add_dll_directory(r"C:\msys64\ucrt64\bin")
    sys.path.insert(0, str(Path(__file__).parents[1]))
    import cpp_solver
    requests = [{
        "id": 1, "lat": 55.75, "lon": 37.61, "window_start": 540,
        "window_end": 720, "service_duration": 30, "required_skills": 4,
        "required_transport": "CAR", "work_type": "EMERGENCY",
    }]
    teams = [{
        "id": 1, "start_lat": 55.75, "start_lon": 37.61,
        "shift_start": 480, "shift_end": 1320, "skills": 4,
        "transport": "CAR", "available": True,
    }]
    result = cpp_solver.solve(requests, teams, 1000, True)
    assert result["timed_out"] is False
    assert result["routes"][0]["request_ids"] == [1]
    assert result["objective"]["unassigned_emergency"] == 0
    assert result["best_valid_solution"] is True


def test_cpp_vnd_never_moves_request_to_incompatible_team():
    import os
    import sys
    from pathlib import Path
    os.add_dll_directory(r"C:\msys64\ucrt64\bin")
    sys.path.insert(0, str(Path(__file__).parents[1]))
    import cpp_solver

    result = cpp_solver.solve([
        {"id": 1, "lat": 55.75, "lon": 37.61, "window_start": 540, "window_end": 900,
         "service_duration": 30, "required_skills": 1, "required_transport": "CAR", "work_type": "LOCAL"},
        {"id": 2, "lat": 55.751, "lon": 37.611, "window_start": 540, "window_end": 900,
         "service_duration": 30, "required_skills": 2, "required_transport": "CAR", "work_type": "CONNECTION"},
    ], [
        {"id": 1, "start_lat": 55.75, "start_lon": 37.61, "shift_start": 480, "shift_end": 1320,
         "skills": 1, "transport": "CAR", "available": True},
        {"id": 2, "start_lat": 55.75, "start_lon": 37.61, "shift_start": 480, "shift_end": 1320,
         "skills": 2, "transport": "CAR", "available": True},
    ], 1000, True)
    assert result["best_valid_solution"] is True
    assert result["timed_out"] is False
    assert result["routes"][0]["request_ids"] == [1]
    assert result["routes"][1]["request_ids"] == [2]


def test_cpp_solver_rejects_cross_region_assignment():
    import os
    import sys
    from pathlib import Path
    os.add_dll_directory(r"C:\msys64\ucrt64\bin")
    sys.path.insert(0, str(Path(__file__).parents[1]))
    import cpp_solver

    result = cpp_solver.solve([
        {"id": 1, "lat": 55.75, "lon": 37.61, "window_start": 540, "window_end": 900,
         "service_duration": 30, "required_skills": 1, "work_type": "REPAIR", "region_id": "zone_1"},
    ], [
        {"id": 1, "start_lat": 55.75, "start_lon": 37.61, "shift_start": 480, "shift_end": 1320,
         "skills": 1, "transport": "CAR", "available": True, "region_id": "zone_2"},
    ], 1000, True)
    assert result["unassigned"] == [1]
    assert result["best_valid_solution"] is True


def test_cpp_schedule_does_not_arrive_before_request_release_time():
    import os
    import sys
    from pathlib import Path
    os.add_dll_directory(r"C:\msys64\ucrt64\bin")
    sys.path.insert(0, str(Path(__file__).parents[1]))
    import cpp_solver

    result = cpp_solver.solve([{
        "id": 81, "lat": 55.76, "lon": 37.62, "window_start": 600,
        "window_end": 1000, "release_time": 797, "service_duration": 80,
        "required_skills": 8, "work_type": "EMERGENCY",
    }], [{
        "id": 81, "start_lat": 55.75, "start_lon": 37.61,
        "shift_start": 600, "shift_end": 1100, "skills": 8,
        "transport": "CAR", "available": True,
    }], 1000, True)

    stop = result["routes"][0]["stops"][0]
    assert stop["arrival"] >= 797
    assert stop["start"] >= 797
