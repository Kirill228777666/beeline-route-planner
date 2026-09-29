#include <pybind11/pybind11.h>
#include <pybind11/stl.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <functional>
#include <limits>
#include <random>
#include <string>
#include <set>
#include <sstream>
#include <stdexcept>
#include <tuple>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace py = pybind11;
using Clock = std::chrono::steady_clock;

namespace {
constexpr double PI = 3.14159265358979323846;

struct Request {
    int index{};
    int id{}; double lat{}, lon{}; int window_start{}, window_end{}, service_duration{}, release_time{};
    int required_skills{}; std::vector<std::string> required_equipment; std::string transport; std::string work_type;
    std::string region_id;
};
struct Team {
    int index{}, transport_index{};
    int id{}; double start_lat{}, start_lon{}; int shift_start{}, shift_end{};
    int skills{}; std::vector<std::string> equipment; std::string transport; bool available{true};
    std::string region_id;
};
struct Stop {
    int request_id{}; int arrival{}, start{}, finish{}, travel_time{}, waiting{}; double distance{};
};
struct Route {
    int team_id{}; std::vector<int> request_ids; std::vector<Stop> stops;
    double distance{}; int travel_time{};
    std::vector<int> latest_start;
};
struct Objective {
    int unassigned_emergency{}, unassigned_connection{}, unassigned_other{}, used_teams{};
    int travel_time{}; double distance{};
};
struct Solution {
    std::vector<Route> routes; std::vector<int> unassigned; Objective objective; bool valid{false};
};

struct SolverConfig {
    int time_limit_ms{3000};
    unsigned seed{42};
    bool use_vnd{true};
    bool use_alns{true};
    bool use_ejection{true};
    bool use_beam{true};
    bool use_route_pool{false};
    bool use_team_minimization{false};
    int multi_start{2};
    int iteration_limit{0};
    bool use_route_elimination{true};
    bool use_exact_neighborhood{false};
    int exact_neighborhood_max_routes{6};
    int exact_neighborhood_node_limit{5000};
    int exact_neighborhood_ejection_depth{2};
};

double haversine(double lat1, double lon1, double lat2, double lon2) {
    const double r = 6371.0088;
    const double p1 = lat1 * PI / 180.0, p2 = lat2 * PI / 180.0;
    const double dp = (lat2 - lat1) * PI / 180.0, dl = (lon2 - lon1) * PI / 180.0;
    const double h = std::sin(dp / 2) * std::sin(dp / 2) + std::cos(p1) * std::cos(p2) * std::sin(dl / 2) * std::sin(dl / 2);
    return 2.0 * r * std::asin(std::sqrt(h));
}

double speed(const std::string& transport) {
    if (transport == "WALK") return 5.0;
    if (transport == "BIKE") return 15.0;
    if (transport == "PUBLIC_TRANSPORT") return 20.0;
    return 30.0;
}

std::tuple<int, double> travel(double lat1, double lon1, double lat2, double lon2, const std::string& transport) {
    const double distance = haversine(lat1, lon1, lat2, lon2);
    return {static_cast<int>(std::llround(distance / speed(transport) * 60.0)), distance};
}

bool compatible(const Team& team, const Request& request) {
    if (!team.available) return false;
    if (team.region_id != request.region_id) return false;
    if ((team.skills & request.required_skills) != request.required_skills) return false;
    if (!request.transport.empty() && request.transport != team.transport) return false;
    for (const auto& item : request.required_equipment) {
        if (std::find(team.equipment.begin(), team.equipment.end(), item) == team.equipment.end()) return false;
    }
    return true;
}

struct Schedule {
    bool valid{false}; std::vector<Stop> stops; double distance{}; int travel_time{};
};

struct TravelKey {
    int team_id{};
    int previous_id{};
    int request_id{};
    bool from_team{false};
    bool operator==(const TravelKey& other) const {
        return team_id == other.team_id && previous_id == other.previous_id &&
               request_id == other.request_id && from_team == other.from_team;
    }
};

struct TravelKeyHash {
    std::size_t operator()(const TravelKey& key) const noexcept {
        std::size_t result = std::hash<int>{}(key.team_id);
        result ^= std::hash<int>{}(key.previous_id) + 0x9e3779b9 + (result << 6) + (result >> 2);
        result ^= std::hash<int>{}(key.request_id) + 0x9e3779b9 + (result << 6) + (result >> 2);
        result ^= std::hash<bool>{}(key.from_team) + 0x9e3779b9 + (result << 6) + (result >> 2);
        return result;
    }
};

Schedule schedule_route_impl(const Team& team, const std::vector<int>& ids,
                        const std::unordered_map<int, Request>& requests) {
    Schedule result; double from_lat = team.start_lat, from_lon = team.start_lon;
    int previous_finish = team.shift_start; bool first = true;
    for (int id : ids) {
        const auto it = requests.find(id); if (it == requests.end()) return result;
        const Request& request = it->second;
        auto [travel_time, distance] = travel(from_lat, from_lon, request.lat, request.lon, team.transport);
        int arrival = std::max(previous_finish, request.release_time) + travel_time;
        int start = std::max(arrival, request.window_start);
        int finish = start + request.service_duration;
        if (start > request.window_end || finish > team.shift_end) return result;
        result.stops.push_back({id, arrival, start, finish, travel_time, start - arrival, distance});
        result.distance += distance; result.travel_time += travel_time;
        previous_finish = finish; from_lat = request.lat; from_lon = request.lon; first = false;
    }
    result.valid = true; return result;
}

bool objective_better(const Objective& a, const Objective& b) {
    return std::tie(a.unassigned_emergency, a.unassigned_connection, a.unassigned_other,
                    a.used_teams, a.travel_time, a.distance) <
           std::tie(b.unassigned_emergency, b.unassigned_connection, b.unassigned_other,
                    b.used_teams, b.travel_time, b.distance);
}

Objective evaluate_objective(const std::vector<Route>& routes, const std::vector<int>& unassigned,
                             const std::unordered_map<int, Request>& requests) {
    Objective objective{};
    for (const auto& route : routes) {
        if (!route.request_ids.empty()) { ++objective.used_teams; objective.travel_time += route.travel_time; objective.distance += route.distance; }
    }
    for (int id : unassigned) {
        const auto& type = requests.at(id).work_type;
        if (type == "EMERGENCY") ++objective.unassigned_emergency;
        else if (type == "CONNECTION") ++objective.unassigned_connection;
        else ++objective.unassigned_other;
    }
    return objective;
}

Solution make_solution(const std::vector<Route>& routes, const std::vector<int>& unassigned,
                       const std::unordered_map<int, Request>& requests) {
    Solution result; result.unassigned = unassigned;
    for (const auto& route : routes) if (!route.request_ids.empty()) result.routes.push_back(route);
    result.objective = evaluate_objective(routes, unassigned, requests); result.valid = true; return result;
}

struct Solver {
    std::vector<Request> requests; std::vector<Team> teams; SolverConfig config{};
    Clock::time_point started; bool timed_out{false};
    int phase_time_limit_ms{};
    std::unordered_map<int, Request> request_map;
    std::vector<Route> route_pool;
    std::unordered_set<std::string> route_pool_keys;
    std::unordered_map<std::string, double> phase_timings_ms;
    std::unordered_map<std::string, long long> profile_counters;
    std::unordered_map<TravelKey, std::pair<int, double>, TravelKeyHash> travel_cache;
    std::unordered_map<long long, bool> compatibility_cache;
    int exact_budget_deadline_ms{0};
    int ejection_budget{};
    std::vector<double> distances;
    std::vector<std::vector<int>> travel_minutes;
    std::vector<std::vector<std::pair<int, double>>> start_legs;
    std::vector<std::vector<unsigned char>> compatible_table;
    long long schedule_calls{}, schedule_stops{}, compatibility_checks{}, insertion_checks{}, insertion_rejects{};
    long long refresh_calls{}, move_evaluations{}, route_copies{}, ejection_nodes{}, insertions_calls{}, beam_states{};
    unsigned deadline_checks{};
    long long cached_elapsed_ms{};

    void prepare_tables() {
        const size_t n = requests.size();
        distances.resize(n * n);
        for (size_t i = 0; i < n; ++i) for (size_t j = 0; j < n; ++j)
            distances[i*n+j] = haversine(requests[i].lat, requests[i].lon, requests[j].lat, requests[j].lon);
        std::vector<std::string> transports;
        for (size_t ti = 0; ti < teams.size(); ++ti) {
            Team& team = teams[ti]; team.index = static_cast<int>(ti);
            auto it = std::find(transports.begin(), transports.end(), team.transport);
            if (it == transports.end()) {
                team.transport_index = static_cast<int>(transports.size());
                transports.push_back(team.transport);
                std::vector<int> times(n*n);
                for (size_t k = 0; k < n*n; ++k)
                    times[k] = static_cast<int>(std::nearbyint(distances[k] / speed(team.transport) * 60.0));
                travel_minutes.push_back(std::move(times));
            } else team.transport_index = static_cast<int>(it - transports.begin());
            start_legs.emplace_back(n);
            compatible_table.emplace_back(n);
            for (size_t j = 0; j < n; ++j) {
                const double d = haversine(team.start_lat, team.start_lon, requests[j].lat, requests[j].lon);
                start_legs.back()[j] = {static_cast<int>(std::nearbyint(d / speed(team.transport) * 60.0)), d};
                compatible_table.back()[j] = compatible(team, requests[j]);
            }
        }
    }

    std::pair<int, double> leg(const Team& team, int previous_id, int id, bool from_team = false) const {
        const auto j = request_map.at(id).index;
        if (from_team) return start_legs[team.index][j];
        const auto k = static_cast<size_t>(request_map.at(previous_id).index) * requests.size() + j;
        return {travel_minutes[team.transport_index][k], distances[k]};
    }

    void count(const std::string& name, long long amount = 1) {
        profile_counters[name] += amount;
    }

    void add_phase(const std::string& name, Clock::time_point phase_started) {
        phase_timings_ms[name] += std::chrono::duration<double, std::milli>(Clock::now() - phase_started).count();
    }

    int exact_phase_deadline_ms() {
        if (config.time_limit_ms <= 0) return 0;
        if (exact_budget_deadline_ms > 0) {
            return phase_time_limit_ms > 0 ? std::min(phase_time_limit_ms, exact_budget_deadline_ms) : exact_budget_deadline_ms;
        }
        const int elapsed = static_cast<int>(std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - started).count());
        const int budget = std::max(25, config.time_limit_ms / 10);
        exact_budget_deadline_ms = elapsed + budget;
        return phase_time_limit_ms > 0 ? std::min(phase_time_limit_ms, exact_budget_deadline_ms) : exact_budget_deadline_ms;
    }

    Schedule schedule_route(const Team& team, const std::vector<int>& ids, bool materialize = true) {
        ++schedule_calls;
        Schedule result;
        if (materialize) result.stops.reserve(ids.size());
        int previous_finish = team.shift_start;
        bool first = true;
        int previous_id = 0;
        for (int id : ids) {
            ++schedule_stops;
            const auto it = request_map.find(id);
            if (it == request_map.end()) return result;
            const Request& request = it->second;
            const auto travel_result = leg(team, previous_id, id, first);
            const int travel_time = travel_result.first;
            const double distance = travel_result.second;
            const int arrival = std::max(previous_finish, request.release_time) + travel_time;
            const int start = std::max(arrival, request.window_start);
            const int finish = start + request.service_duration;
            if (start > request.window_end || finish > team.shift_end) return result;
            if (materialize) result.stops.push_back({id, arrival, start, finish, travel_time, start - arrival, distance});
            result.distance += distance;
            result.travel_time += travel_time;
            previous_finish = finish;
            previous_id = id;
            first = false;
        }
        result.valid = true;
        return result;
    }

    bool compatible_cached(const Team& team, const Request& request) {
        ++compatibility_checks;
        return compatible_table[team.index][request.index] != 0;
    }

    bool expired() {
        if (config.time_limit_ms <= 0) return false;
        if ((deadline_checks++ & 31u) == 0)
            cached_elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - started).count();
        const auto elapsed = cached_elapsed_ms;
        if (elapsed >= config.time_limit_ms) { timed_out = true; return true; }
        if (phase_time_limit_ms > 0 && elapsed >= phase_time_limit_ms) return true;
        return false;
    }

    std::vector<Route> initial_routes() const {
        std::vector<Route> routes; routes.reserve(teams.size());
        for (const auto& team : teams) routes.push_back(Route{team.id});
        return routes;
    }

    void restore_solution(std::vector<Route>& routes, const Solution& solution) const {
        routes = initial_routes();
        for (const auto& route : solution.routes) {
            const int ti = team_index_for_id(route.team_id);
            if (ti >= 0) routes[ti] = route;
        }
    }

    struct Insertion { int team_index{}, position{}, request_id{}; int delta_time{}; double delta_distance{}; };

    void apply_insertion(Route& route, const Insertion& insertion) {
        route.request_ids.insert(route.request_ids.begin() + insertion.position, insertion.request_id);
    }

    bool insertion_delta(const Request& request, const Route& route, int ti, int position,
                         int& delta_time, double& delta_distance) {
        ++insertion_checks;
        const Team& team = teams[ti];
        const auto incoming = leg(team, position ? route.request_ids[position-1] : 0, request.id, position == 0);
        const int departure = std::max(position ? route.stops[position-1].finish : team.shift_start,
                                       request.release_time);
        const int finish = std::max(departure + incoming.first, request.window_start) + request.service_duration;
        if (finish > team.shift_end || finish - request.service_duration > request.window_end) {
            ++insertion_rejects; return false;
        }
        delta_time = incoming.first; delta_distance = incoming.second;
        if (position < static_cast<int>(route.request_ids.size())) {
            const auto outgoing = leg(team, request.id, route.request_ids[position]);
            if (finish + outgoing.first > route.latest_start[position]) { ++insertion_rejects; return false; }
            delta_time += outgoing.first - route.stops[position].travel_time;
            delta_distance += outgoing.second - route.stops[position].distance;
        }
        return true;
    }

    std::vector<Insertion> insertions(const Request& request, const std::vector<Route>& routes, int excluded_team = -1) {
        ++insertions_calls;
        std::vector<Insertion> result;
        for (size_t ti = 0; ti < teams.size(); ++ti) {
            if (static_cast<int>(ti) == excluded_team) continue;
            if (excluded_team >= 0 && routes[ti].request_ids.empty()) continue;
            if (!compatible_cached(teams[ti], request)) continue;
            const auto& route = routes[ti];
            for (int position = 0; position <= static_cast<int>(route.request_ids.size()); ++position) {
                if (expired()) return result;
                int dt; double dd;
                if (insertion_delta(request, route, static_cast<int>(ti), position, dt, dd)) {
                    result.push_back({static_cast<int>(ti), position, request.id, dt, dd});
                }
            }
        }
        return result;
    }

    std::vector<Insertion> neighborhood_insertions(const Request& request, const std::vector<Route>& routes,
                                                   const std::vector<int>& allowed_team_indices) {
        std::vector<Insertion> result;
        for (int ti : allowed_team_indices) {
            if (ti < 0 || static_cast<size_t>(ti) >= teams.size()) continue;
            if (!compatible_cached(teams[ti], request)) continue;
            const auto& route = routes[ti];
            for (int position = 0; position <= static_cast<int>(route.request_ids.size()); ++position) {
                if (expired()) return result;
                int dt; double dd;
                if (insertion_delta(request, route, ti, position, dt, dd)) {
                    result.push_back({ti, position, request.id, dt, dd});
                }
            }
        }
        return result;
    }

    bool route_compatible(const Route& route, int team_index) {
        for (int id : route.request_ids) if (!compatible_cached(teams[team_index], request_map.at(id))) return false;
        return true;
    }

    int team_index_for_id(int team_id) const {
        for (size_t i = 0; i < teams.size(); ++i) if (teams[i].id == team_id) return static_cast<int>(i);
        return -1;
    }

    std::string route_key(const Route& route) const {
        std::ostringstream key;
        key << route.team_id << ':';
        for (int id : route.request_ids) key << id << ',';
        return key.str();
    }

    void add_to_route_pool(const std::vector<Route>& routes) {
        if (!config.use_route_pool) return;
        const auto phase_started = Clock::now();
        for (size_t ti = 0; ti < routes.size() && ti < teams.size(); ++ti) {
            if (routes[ti].request_ids.empty() || !route_compatible(routes[ti], static_cast<int>(ti))) continue;
            const std::string key = route_key(routes[ti]);
            count("route_pool_lookup");
            if (route_pool_keys.contains(key)) continue;
            Schedule schedule = schedule_route(teams[ti], routes[ti].request_ids);
            if (!schedule.valid) continue;
            Route route = routes[ti];
            route.team_id = teams[ti].id; route.stops = std::move(schedule.stops);
            route.distance = schedule.distance; route.travel_time = schedule.travel_time;
            const bool inserted = route_pool_keys.insert(key).second;
            if (inserted) { route_pool.push_back(std::move(route)); count("route_pool_insert"); }
        }
        add_phase("route_pool", phase_started);
    }

    void apply_warm_start(const std::vector<Route>& warm_start, std::vector<Route>& routes, std::vector<int>& remaining) {
        std::set<int> assigned;
        std::set<int> used_teams;
        for (const auto& item : warm_start) {
            const int team_id = item.team_id;
            int team_index = -1;
            for (size_t i = 0; i < teams.size(); ++i) if (teams[i].id == team_id) { team_index = static_cast<int>(i); break; }
            if (team_index < 0 || used_teams.contains(team_id)) continue;
            const auto& ids = item.request_ids;
            bool duplicate = false;
            std::set<int> local_ids;
            for (int id : ids) if (!request_map.contains(id) || assigned.contains(id) || !local_ids.insert(id).second) duplicate = true;
            if (duplicate) continue;
            Route candidate = routes[team_index]; candidate.request_ids = ids;
            if (!route_compatible(candidate, team_index) || !refresh(candidate, team_index)) continue;
            routes[team_index] = std::move(candidate);
            used_teams.insert(team_id);
            for (int id : ids) { assigned.insert(id); remaining.erase(std::remove(remaining.begin(), remaining.end(), id), remaining.end()); }
        }
    }

    bool construct_with_regret3(std::vector<Route>& routes, std::vector<int>& remaining) {
        bool inserted_any = false;
        while (!remaining.empty() && !expired()) {
            struct Choice { int id{}; std::vector<Insertion> options; int regret{}; int eligible{}; int width{}; int priority{}; };
            std::vector<Choice> choices;
            for (int id : remaining) {
                const auto& request = request_map.at(id);
                auto options = insertions(request, routes);
                if (options.empty()) continue;
                std::sort(options.begin(), options.end(), [](const Insertion& a, const Insertion& b) {
                    return std::tie(a.delta_time, a.delta_distance) < std::tie(b.delta_time, b.delta_distance);
                });
                const int best = options.front().delta_time;
                int regret = 0;
                for (size_t i = 1; i < std::min<size_t>(3, options.size()); ++i)
                    regret += options[i].delta_time - best;
                std::set<int> feasible_team_indices;
                for (const auto& option : options) feasible_team_indices.insert(option.team_index);
                choices.push_back({id, std::move(options), regret, static_cast<int>(feasible_team_indices.size()),
                                   request.window_end - request.window_start,
                                   request.work_type == "EMERGENCY" ? 3 : request.work_type == "CONNECTION" ? 2 : 1});
            }
            if (choices.empty()) break;
            auto chosen = std::min_element(choices.begin(), choices.end(), [](const Choice& a, const Choice& b) {
                return std::tuple(-a.priority, a.eligible, a.width, -a.regret, a.id) <
                       std::tuple(-b.priority, b.eligible, b.width, -b.regret, b.id);
            });
            const auto& insertion = chosen->options.front();
            apply_insertion(routes[insertion.team_index], insertion);
            if (!refresh(routes[insertion.team_index], insertion.team_index))
                throw std::logic_error("accepted insertion became infeasible during refresh");
            remaining.erase(std::find(remaining.begin(), remaining.end(), chosen->id));
            inserted_any = true;
            count("regret_repair_insertions");
        }
        return inserted_any;
    }

    Solution solve(const std::vector<Route>& warm_start = {}) {
        started = Clock::now();
        for (size_t i = 0; i < requests.size(); ++i) {
            requests[i].index = static_cast<int>(i);
            if (!request_map.emplace(requests[i].id, requests[i]).second) throw std::invalid_argument("duplicate request id");
        }
        std::set<int> team_ids;
        for (const auto& team : teams) if (!team_ids.insert(team.id).second) throw std::invalid_argument("duplicate team id");
        const auto tables_started = Clock::now();
        prepare_tables();
        add_phase("matrix_preparation", tables_started);
        std::vector<Route> routes = initial_routes(); std::vector<int> remaining;
        for (const auto& request : requests) remaining.push_back(request.id);
        apply_warm_start(warm_start, routes, remaining);
        const auto regret_started = Clock::now();
        construct_with_regret3(routes, remaining);
        for (auto& route : routes) {
            auto result = schedule_route(teams[&route - routes.data()], route.request_ids);
            route.stops = std::move(result.stops); route.distance = result.distance; route.travel_time = result.travel_time;
        }
        add_phase("regret3", regret_started);
        Solution best = make_solution(routes, remaining, request_map);
        if (config.use_vnd && !expired()) {
            const auto phase_started = Clock::now();
            if (config.use_alns && config.time_limit_ms > 0 && config.iteration_limit == 0)
                phase_time_limit_ms = static_cast<int>(std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now()-started).count()) +
                                      std::max(20, config.time_limit_ms / 5);
            best = vnd(routes, remaining, best);
            phase_time_limit_ms = 0;
            add_phase("vnd", phase_started);
        }
        if (!remaining.empty() && !expired()) {
            const auto repair_started = Clock::now();
            const size_t remaining_before_repair = remaining.size();
            regret_repair(routes, remaining, -1);
            const bool repaired = remaining.size() < remaining_before_repair;
            add_phase("post_vnd_regret_repair", repair_started);
            if (repaired) {
                best = make_solution(routes, remaining, request_map);
                if (config.use_vnd && !expired()) {
                    const auto second_vnd_started = Clock::now();
                    best = vnd(routes, remaining, best);
                    add_phase("post_repair_vnd", second_vnd_started);
                }
            }
        }
        add_to_route_pool(routes);
        if (config.use_route_elimination && !expired()) {
            const auto phase_started = Clock::now();
            best = eliminate_routes(routes, remaining, best);
            add_phase("route_elimination", phase_started);
        }
        if (config.use_exact_neighborhood && remaining.empty() && !expired()) {
            std::mt19937 exact_rng(config.seed + 104729u);
            const int previous_phase_limit = phase_time_limit_ms;
            phase_time_limit_ms = exact_phase_deadline_ms();
            best = exact_neighborhood(routes, remaining, best, exact_rng);
            phase_time_limit_ms = previous_phase_limit;
        }
        if (config.use_alns && !expired()) {
            const auto phase_started = Clock::now();
            const std::vector<Route> alns_base = routes;
            const int starts = std::max(1, config.multi_start);
            const int alns_begin = static_cast<int>(std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now()-started).count());
            const int alns_end = config.time_limit_ms > 0 && config.iteration_limit == 0 ? config.time_limit_ms * (config.use_route_pool ? 75 : 90) / 100 : 0;
            for (int start = 0; start < starts && !expired(); ++start) {
                phase_time_limit_ms = alns_end > 0 ? alns_begin + std::max(0, alns_end-alns_begin) * (start+1) / starts : 0;
                if (expired()) { phase_time_limit_ms = 0; continue; }
                count("multi_starts");
                std::vector<Route> candidate_routes = alns_base;
                if (start > 0) restore_solution(candidate_routes, best);
                Solution candidate = alns(candidate_routes, remaining, best, config.seed + static_cast<unsigned>(start) * 7919u);
                add_to_route_pool(candidate_routes);
                if (candidate.valid && objective_better(candidate.objective, best.objective)) {
                    best = std::move(candidate); routes = std::move(candidate_routes);
                }
                phase_time_limit_ms = 0;
            }
            phase_time_limit_ms = 0;
            add_phase("alns", phase_started);
        }
        if (config.use_route_pool && !expired()) {
            const auto phase_started = Clock::now();
            best = recombine_routes(routes, remaining, best, -1);
            add_phase("route_pool", phase_started);
        }
        if (config.use_team_minimization && !expired()) {
            const auto phase_started = Clock::now();
            best = minimize_teams(routes, remaining, best);
            add_phase("team_minimization", phase_started);
        }
        if (config.use_vnd && config.use_alns && !expired()) {
            restore_solution(routes, best);
            const auto finish_started = Clock::now();
            best = vnd(routes, remaining, best);
            add_phase("final_vnd", finish_started);
        }
        profile_counters["schedule_route_calls"] = schedule_calls;
        profile_counters["schedule_stops"] = schedule_stops;
        profile_counters["compatibility_checks"] = compatibility_checks;
        profile_counters["insertion_checks"] = insertion_checks;
        profile_counters["insertion_rejects"] = insertion_rejects;
        profile_counters["refresh_calls"] = refresh_calls;
        profile_counters["move_evaluations"] = move_evaluations;
        profile_counters["route_copies"] = route_copies;
        profile_counters["ejection_nodes"] = ejection_nodes;
        profile_counters["insertions_calls"] = insertions_calls;
        profile_counters["beam_states"] = beam_states;
        best.valid = true; return best;
    }

    Solution vnd(std::vector<Route>& routes, const std::vector<int>& unassigned, Solution best) {
        bool improved = true;
        while (improved && !expired()) {
            improved = false;
            for (int op = 0; op < 4 && !expired(); ++op) {
                bool accepted = false;
                if (op == 0) accepted = relocate(routes, unassigned, best);
                if (op == 1) accepted = swap(routes, unassigned, best);
                if (op == 2) accepted = two_opt(routes, unassigned, best);
                if (op == 3) accepted = two_opt_star(routes, unassigned, best);
                if (accepted) { improved = true; break; }
            }
        }
        return best;
    }

    bool refresh(Route& route, int team_index) {
        ++refresh_calls;
        Schedule result = schedule_route(teams[team_index], route.request_ids);
        if (!result.valid) return false;
        route.stops = std::move(result.stops); route.distance = result.distance; route.travel_time = result.travel_time;
        route.latest_start.resize(route.request_ids.size());
        for (int i = static_cast<int>(route.request_ids.size()) - 1; i >= 0; --i) {
            const auto& request = request_map.at(route.request_ids[i]);
            const int end = i + 1 == static_cast<int>(route.request_ids.size()) ? teams[team_index].shift_end :
                route.latest_start[i+1] - route.stops[i+1].travel_time;
            route.latest_start[i] = std::min(request.window_end, end - request.service_duration);
        }
        return true;
    }

    bool try_move(std::vector<Route>& routes, const std::vector<int>& unassigned, Solution& best,
                  int a, std::vector<int> left, int b = -1, std::vector<int> right = {}) {
        ++move_evaluations;
        Objective objective = best.objective;
        objective.used_teams += !left.empty() - static_cast<int>(!routes[a].request_ids.empty());
        if (b >= 0) objective.used_teams += !right.empty() - static_cast<int>(!routes[b].request_ids.empty());
        if (objective.used_teams > best.objective.used_teams) return false;
        for (int id : left) if (!compatible_cached(teams[a], request_map.at(id))) return false;
        if (b >= 0) for (int id : right) if (!compatible_cached(teams[b], request_map.at(id))) return false;
        const Schedule sa = schedule_route(teams[a], left, false);
        if (!sa.valid) return false;
        objective.travel_time += sa.travel_time - routes[a].travel_time;
        objective.distance += sa.distance - routes[a].distance;
        if (b >= 0) {
            const Schedule sb = schedule_route(teams[b], right, false);
            if (!sb.valid) return false;
            objective.travel_time += sb.travel_time - routes[b].travel_time;
            objective.distance += sb.distance - routes[b].distance;
        }
        if (objective.used_teams == best.objective.used_teams &&
            objective.travel_time == best.objective.travel_time &&
            objective.distance >= best.objective.distance - 1e-9) return false;
        if (!objective_better(objective, best.objective)) return false;
        routes[a].request_ids = std::move(left); refresh(routes[a], a);
        if (b >= 0) { routes[b].request_ids = std::move(right); refresh(routes[b], b); }
        count("accepted_moves"); best = make_solution(routes, unassigned, request_map); return true;
    }

    bool relocate(std::vector<Route>& routes, const std::vector<int>& unassigned, Solution& best) {
        for (size_t a = 0; a < routes.size(); ++a) for (size_t i = 0; i < routes[a].request_ids.size(); ++i) {
            int id = routes[a].request_ids[i];
            for (size_t b = 0; b < routes.size(); ++b) for (int pos = 0; pos <= static_cast<int>(routes[b].request_ids.size()); ++pos) {
                if (expired()) return false;
                if (a == b && (pos == static_cast<int>(i) || pos == static_cast<int>(i + 1))) continue;
                if (!compatible_cached(teams[b], request_map.at(id))) continue;
                auto left = routes[a].request_ids;
                left.erase(left.begin() + static_cast<long>(i));
                int adjusted = (a == b && pos > static_cast<int>(i)) ? pos - 1 : pos;
                if (a == b) {
                    left.insert(left.begin() + adjusted, id);
                    if (try_move(routes, unassigned, best, static_cast<int>(a), std::move(left))) return true;
                } else {
                    auto right = routes[b].request_ids; right.insert(right.begin() + adjusted, id);
                    if (try_move(routes, unassigned, best, static_cast<int>(a), std::move(left), static_cast<int>(b), std::move(right))) return true;
                }
            }
        }
        return false;
    }

    bool swap(std::vector<Route>& routes, const std::vector<int>& unassigned, Solution& best) {
        for (size_t a = 0; a < routes.size(); ++a) for (size_t b = a + 1; b < routes.size(); ++b)
            for (size_t i = 0; i < routes[a].request_ids.size(); ++i) for (size_t j = 0; j < routes[b].request_ids.size(); ++j) {
                if (expired()) return false;
                int left_id = routes[a].request_ids[i], right_id = routes[b].request_ids[j];
                if (!compatible_cached(teams[a], request_map.at(right_id)) || !compatible_cached(teams[b], request_map.at(left_id))) continue;
                auto left = routes[a].request_ids, right = routes[b].request_ids;
                std::swap(left[i], right[j]);
                if (try_move(routes, unassigned, best, static_cast<int>(a), std::move(left), static_cast<int>(b), std::move(right))) return true;
            }
        return false;
    }

    bool two_opt(std::vector<Route>& routes, const std::vector<int>& unassigned, Solution& best) {
        for (size_t t = 0; t < routes.size(); ++t) for (size_t i = 0; i < routes[t].request_ids.size(); ++i)
            for (size_t j = i + 2; j <= routes[t].request_ids.size(); ++j) {
                if (expired()) return false;
                auto ids = routes[t].request_ids;
                std::reverse(ids.begin() + static_cast<long>(i), ids.begin() + static_cast<long>(j));
                if (try_move(routes, unassigned, best, static_cast<int>(t), std::move(ids))) return true;
            }
        return false;
    }

    bool two_opt_star(std::vector<Route>& routes, const std::vector<int>& unassigned, Solution& best) {
        for (size_t a = 0; a < routes.size(); ++a) for (size_t b = a + 1; b < routes.size(); ++b) {
            for (size_t cut_a = 0; cut_a <= routes[a].request_ids.size(); ++cut_a)
                for (size_t cut_b = 0; cut_b <= routes[b].request_ids.size(); ++cut_b) {
                    if (expired()) return false;
                    std::vector<int> left(routes[a].request_ids.begin(), routes[a].request_ids.begin() + static_cast<long>(cut_a));
                    std::vector<int> right(routes[b].request_ids.begin(), routes[b].request_ids.begin() + static_cast<long>(cut_b));
                    left.insert(left.end(), routes[b].request_ids.begin() + static_cast<long>(cut_b), routes[b].request_ids.end());
                    right.insert(right.end(), routes[a].request_ids.begin() + static_cast<long>(cut_a), routes[a].request_ids.end());
                    if (try_move(routes, unassigned, best, static_cast<int>(a), std::move(left), static_cast<int>(b), std::move(right))) return true;
                }
        }
        return false;
    }

    bool exact_bound_worse(const std::vector<Route>& routes, const Solution& incumbent) const {
        int used_teams = 0;
        for (const auto& route : routes) {
            if (route.request_ids.empty()) continue;
            ++used_teams;
        }
        return used_teams > incumbent.objective.used_teams;
    }

    bool exact_repack_search(std::vector<Route>& routes, const std::vector<int>& pending,
                             const std::vector<int>& allowed_team_indices,
                             const std::vector<int>& unassigned, Solution& incumbent,
                             std::vector<Route>& best_routes, int& nodes, int ejection_depth) {
        if (expired() || nodes >= config.exact_neighborhood_node_limit) return false;
        ++nodes;
        count("exact_neighborhood_nodes");
        if (pending.empty()) {
            Solution candidate = make_solution(routes, unassigned, request_map);
            if (candidate.valid && objective_better(candidate.objective, incumbent.objective)) {
                incumbent = std::move(candidate);
                best_routes = routes;
                return true;
            }
            return false;
        }
        if (exact_bound_worse(routes, incumbent)) {
            count("exact_neighborhood_pruned");
            return false;
        }

        struct Choice { int id{}; std::vector<Insertion> options; int regret{}; int eligible{}; int width{}; int priority{}; };
        std::vector<Choice> choices;
        for (int id : pending) {
            const auto& request = request_map.at(id);
            auto options = neighborhood_insertions(request, routes, allowed_team_indices);
            if (options.empty() && ejection_depth <= 0) { count("exact_neighborhood_pruned"); return false; }
            std::sort(options.begin(), options.end(), [](const Insertion& a, const Insertion& b) {
                return std::tie(a.delta_time, a.delta_distance, a.team_index, a.position) <
                       std::tie(b.delta_time, b.delta_distance, b.team_index, b.position);
            });
            const int best_delta = options.empty() ? 0 : options.front().delta_time;
            int regret = 0;
            for (size_t i = 1; i < std::min<size_t>(3, options.size()); ++i) regret += options[i].delta_time - best_delta;
            std::set<int> eligible;
            for (const auto& option : options) eligible.insert(option.team_index);
            choices.push_back({id, std::move(options), regret, static_cast<int>(eligible.size()),
                               request.window_end - request.window_start,
                               request.work_type == "EMERGENCY" ? 3 : request.work_type == "CONNECTION" ? 2 : 1});
        }
        if (choices.empty()) {
            count("exact_neighborhood_pruned");
            return false;
        }
        auto chosen = std::min_element(choices.begin(), choices.end(), [](const Choice& a, const Choice& b) {
            return std::tuple(-a.priority, a.eligible, a.width, -a.regret, a.id) <
                   std::tuple(-b.priority, b.eligible, b.width, -b.regret, b.id);
        });
        std::vector<int> next_pending = pending;
        next_pending.erase(std::find(next_pending.begin(), next_pending.end(), chosen->id));
        bool improved = false;
        for (const auto& insertion : chosen->options) {
            if (expired() || nodes >= config.exact_neighborhood_node_limit) break;
            Route backup = routes[insertion.team_index];
            ++route_copies;
            apply_insertion(routes[insertion.team_index], insertion);
            if (refresh(routes[insertion.team_index], insertion.team_index)) {
                if (exact_repack_search(routes, next_pending, allowed_team_indices, unassigned,
                                        incumbent, best_routes, nodes, ejection_depth)) improved = true;
            }
            routes[insertion.team_index] = std::move(backup);
        }
        if (ejection_depth <= 0) return improved;
        for (int team_index : allowed_team_indices) {
            if (expired() || nodes >= config.exact_neighborhood_node_limit) break;
            if (!compatible_cached(teams[team_index], request_map.at(chosen->id))) continue;
            for (size_t victim_position = 0; victim_position < routes[team_index].request_ids.size(); ++victim_position) {
                const int victim = routes[team_index].request_ids[victim_position];
                for (size_t position = 0; position <= routes[team_index].request_ids.size(); ++position) {
                    if (expired() || nodes >= config.exact_neighborhood_node_limit) break;
                    Route backup = routes[team_index];
                    ++route_copies;
                    routes[team_index].request_ids.erase(routes[team_index].request_ids.begin() + static_cast<long>(victim_position));
                    const size_t adjusted_position = position > victim_position ? position - 1 : position;
                    routes[team_index].request_ids.insert(routes[team_index].request_ids.begin() + static_cast<long>(adjusted_position), chosen->id);
                    if (refresh(routes[team_index], team_index)) {
                        count("exact_neighborhood_ejections");
                        std::vector<int> ejected_pending = next_pending;
                        ejected_pending.push_back(victim);
                        if (exact_repack_search(routes, ejected_pending, allowed_team_indices, unassigned,
                                                incumbent, best_routes, nodes, ejection_depth - 1)) improved = true;
                    }
                    routes[team_index] = std::move(backup);
                }
            }
        }
        return improved;
    }

    Solution exact_neighborhood(std::vector<Route>& routes, const std::vector<int>& unassigned,
                                Solution best, std::mt19937& rng) {
        if (!config.use_exact_neighborhood || !unassigned.empty()) return best;
        const auto phase_started = Clock::now();
        count("exact_neighborhood_attempts");
        auto active = active_route_indices(routes);
        if (active.size() < 3) {
            add_phase("exact_neighborhood", phase_started);
            return best;
        }
        std::sort(active.begin(), active.end(), [&](int a, int b) {
            return std::make_tuple(routes[a].request_ids.size(), a) <
                   std::make_tuple(routes[b].request_ids.size(), b);
        });
        const int max_routes = std::min<int>(config.exact_neighborhood_max_routes, static_cast<int>(active.size()));
        std::uniform_int_distribution<int> size_pick(3, max_routes);
        const int selected_size = size_pick(rng);
        const size_t max_start = active.size() > static_cast<size_t>(selected_size) ? active.size() - selected_size : 0;
        std::uniform_int_distribution<size_t> start_pick(0, max_start);
        const size_t start = start_pick(rng);
        std::vector<int> group(active.begin() + static_cast<long>(start),
                               active.begin() + static_cast<long>(start + selected_size));

        for (int remove_position = 0; remove_position < selected_size && !expired(); ++remove_position) {
            std::vector<Route> backup = routes;
            route_copies += static_cast<long long>(routes.size());
            std::vector<int> pending;
            std::vector<int> allowed;
            for (int position = 0; position < selected_size; ++position) {
                const int route_index = group[position];
                pending.insert(pending.end(), routes[route_index].request_ids.begin(), routes[route_index].request_ids.end());
                if (position != remove_position) allowed.push_back(route_index);
                routes[route_index] = Route{teams[route_index].id};
            }
            std::vector<Route> best_routes = routes;
            int nodes = 0;
            Solution candidate = best;
            const bool found = exact_repack_search(routes, pending, allowed, unassigned, candidate, best_routes, nodes,
                                                   config.exact_neighborhood_ejection_depth);
            if (found && candidate.objective.used_teams < best.objective.used_teams) {
                routes = std::move(best_routes);
                best = std::move(candidate);
                count("exact_neighborhood_successes");
                if (config.use_vnd && !expired()) best = vnd(routes, unassigned, best);
                add_phase("exact_neighborhood", phase_started);
                return best;
            }
            routes = std::move(backup);
        }
        add_phase("exact_neighborhood", phase_started);
        return best;
    }

    Solution eliminate_routes(std::vector<Route>& routes, const std::vector<int>& unassigned, Solution best) {
        if (!unassigned.empty()) return best;
        while (!expired()) {
            std::vector<int> candidates;
            for (size_t i = 0; i < routes.size(); ++i) if (!routes[i].request_ids.empty()) candidates.push_back(static_cast<int>(i));
            std::sort(candidates.begin(), candidates.end(), [&](int a, int b) {
                return std::make_tuple(routes[a].request_ids.size(), a) < std::make_tuple(routes[b].request_ids.size(), b);
            });
            bool eliminated = false;
            for (int candidate_index : candidates) {
                if (expired()) return best;
                route_copies += static_cast<long long>(routes.size());
                std::vector<Route> backup = routes;
                std::vector<int> pending = routes[candidate_index].request_ids;
                routes[candidate_index].request_ids.clear();
                routes[candidate_index].stops.clear(); routes[candidate_index].distance = 0.0; routes[candidate_index].travel_time = 0;
                const bool repaired = repair_route_requests(routes, pending, candidate_index);
                if (repaired && pending.empty()) {
                    Solution candidate = make_solution(routes, unassigned, request_map);
                    if (candidate.valid && objective_better(candidate.objective, best.objective)) {
                        best = std::move(candidate); eliminated = true; break;
                    }
                }
                routes = std::move(backup);
            }
            if (!eliminated) break;
        }
        return best;
    }

    bool beam_repair(std::vector<Route>& routes, const std::vector<int>& source_pending, int excluded_team) {
        struct State { std::vector<Route> routes; std::vector<int> pending; };
        std::vector<State> beam{{routes, source_pending}};
        constexpr size_t beam_width = 8;
        while (!beam.empty() && !expired()) {
            std::vector<State> next;
            bool complete = false;
            for (auto& state : beam) {
                ++beam_states;
                add_to_route_pool(state.routes);
                if (state.pending.empty()) { routes = std::move(state.routes); return true; }
                int selected = state.pending.front();
                auto selected_options = insertions(request_map.at(selected), state.routes, excluded_team);
                if (selected_options.empty()) continue;
                std::sort(selected_options.begin(), selected_options.end(), [](const Insertion& a, const Insertion& b) {
                    return std::tie(a.delta_time, a.delta_distance, a.team_index, a.position) <
                           std::tie(b.delta_time, b.delta_distance, b.team_index, b.position);
                });
                const size_t option_limit = std::min<size_t>(selected_options.size(), 24);
                for (size_t i = 0; i < option_limit && !expired(); ++i) {
                    State child = state;
                    apply_insertion(child.routes[selected_options[i].team_index], selected_options[i]);
                    if (!refresh(child.routes[selected_options[i].team_index], selected_options[i].team_index)) continue;
                    child.pending.erase(std::find(child.pending.begin(), child.pending.end(), selected));
                    next.push_back(std::move(child));
                }
            }
            if (next.empty()) break;
            std::sort(next.begin(), next.end(), [&](const State& a, const State& b) {
                auto score = [&](const State& state) {
                    int used = 0, travel_time = 0; double distance = 0.0;
                    for (const auto& route : state.routes) if (!route.request_ids.empty()) { ++used; travel_time += route.travel_time; distance += route.distance; }
                    return std::tuple(state.pending.size(), used, travel_time, distance);
                };
                return score(a) < score(b);
            });
            if (next.size() > beam_width) next.resize(beam_width);
            beam = std::move(next);
        }
        return false;
    }

    bool ejection_repair(std::vector<Route>& routes, std::vector<int>& pending, int excluded_team, int depth_left) {
        ++ejection_nodes;
        if (pending.empty()) return true;
        if (expired() || --ejection_budget < 0) return false;
        const std::vector<int> entry_pending = pending;
        int selected = pending.front();
        auto direct = insertions(request_map.at(selected), routes, excluded_team);
        std::sort(direct.begin(), direct.end(), [](const Insertion& a, const Insertion& b) {
            return std::tie(a.delta_time, a.delta_distance, a.team_index, a.position) <
                   std::tie(b.delta_time, b.delta_distance, b.team_index, b.position);
        });
        for (const auto& insertion : direct) {
            if (expired() || ejection_budget < 0) break;
            Route backup = routes[insertion.team_index];
            apply_insertion(routes[insertion.team_index], insertion);
            if (refresh(routes[insertion.team_index], insertion.team_index)) {
                pending.erase(std::find(pending.begin(), pending.end(), selected));
                if (ejection_repair(routes, pending, excluded_team, depth_left)) return true;
            }
            routes[insertion.team_index] = std::move(backup);
            pending = entry_pending;
        }
        if (depth_left <= 0 || ejection_budget < 0) return false;
        for (size_t ti = 0; ti < routes.size(); ++ti) {
            if (static_cast<int>(ti) == excluded_team || !compatible_cached(teams[ti], request_map.at(selected))) continue;
            for (size_t victim_pos = 0; victim_pos < routes[ti].request_ids.size(); ++victim_pos) {
                const int victim = routes[ti].request_ids[victim_pos];
                for (size_t position = 0; position <= routes[ti].request_ids.size(); ++position) {
                    if (expired() || ejection_budget < 0) return false;
                    ++route_copies;
                    Route backup = routes[ti];
                    routes[ti].request_ids.erase(routes[ti].request_ids.begin() + static_cast<long>(victim_pos));
                    const size_t adjusted_position = position > victim_pos ? position - 1 : position;
                    routes[ti].request_ids.insert(routes[ti].request_ids.begin() + static_cast<long>(adjusted_position), selected);
                    if (refresh(routes[ti], static_cast<int>(ti))) {
                        pending.erase(std::find(pending.begin(), pending.end(), selected));
                        pending.push_back(victim);
                        if (ejection_repair(routes, pending, excluded_team, depth_left - 1)) return true;
                    }
                    routes[ti] = std::move(backup);
                    pending = entry_pending;
                }
            }
        }
        return false;
    }

    bool repair_route_requests(std::vector<Route>& routes, std::vector<int>& pending, int excluded_team) {
        const auto phase_started = Clock::now();
        const std::vector<Route> backup = routes;
        std::vector<int> original = pending;
        if (regret_repair(routes, pending, excluded_team)) { add_phase("ejection_beam", phase_started); return true; }
        ejection_budget = 600;
        if (config.use_ejection && ejection_repair(routes, pending, excluded_team, 4)) { add_phase("ejection_beam", phase_started); return true; }
        routes = backup;
        if (config.use_beam && beam_repair(routes, original, excluded_team)) { pending.clear(); add_phase("ejection_beam", phase_started); return true; }
        routes = backup; pending = original;
        add_phase("ejection_beam", phase_started);
        return false;
    }

    Solution recombine_routes(std::vector<Route>& routes, const std::vector<int>& unassigned, Solution best, int max_routes) {
        if (!unassigned.empty() || route_pool.empty()) return best;
        std::unordered_map<int, int> request_index;
        for (size_t i = 0; i < requests.size(); ++i) request_index[requests[i].id] = static_cast<int>(i);
        std::vector<std::vector<int>> covering(requests.size());
        std::vector<int> route_team_index(route_pool.size(), -1);
        for (size_t ri = 0; ri < route_pool.size(); ++ri) {
            const int team_index = team_index_for_id(route_pool[ri].team_id);
            if (team_index < 0 || !route_compatible(route_pool[ri], team_index)) continue;
            route_team_index[ri] = team_index;
            bool valid_route = true;
            std::set<int> unique_ids;
            for (int id : route_pool[ri].request_ids) {
                auto it = request_index.find(id);
                if (it == request_index.end() || !unique_ids.insert(id).second) { valid_route = false; break; }
                covering[it->second].push_back(static_cast<int>(ri));
            }
            if (!valid_route) {
                for (int id : route_pool[ri].request_ids) {
                    auto it = request_index.find(id);
                    if (it != request_index.end()) {
                        auto& list = covering[it->second];
                        list.erase(std::remove(list.begin(), list.end(), static_cast<int>(ri)), list.end());
                    }
                }
                route_team_index[ri] = -1;
            }
        }
        for (auto& list : covering) {
            std::sort(list.begin(), list.end(), [&](int a, int b) {
                return std::make_tuple(route_pool[a].request_ids.size(), route_pool[a].travel_time, route_pool[a].distance) >
                       std::make_tuple(route_pool[b].request_ids.size(), route_pool[b].travel_time, route_pool[b].distance);
            });
            if (list.size() > 120) list.resize(120);
        }
        std::vector<char> covered(requests.size(), 0), team_used(teams.size(), 0);
        std::vector<int> selected, best_selected;
        int covered_count = 0;
        const int incumbent_count = best.objective.used_teams;
        int best_count = max_routes > 0 ? max_routes : incumbent_count;
        int best_time = best.objective.travel_time;
        double best_distance = best.objective.distance;
        std::vector<Route> recombined_routes;
        std::function<void()> search = [&]() {
            if (expired()) return;
            if (covered_count == static_cast<int>(requests.size())) {
                int time = 0; double distance = 0.0;
                for (int ri : selected) { time += route_pool[ri].travel_time; distance += route_pool[ri].distance; }
                const bool within_limit = max_routes <= 0 || selected.size() <= static_cast<size_t>(max_routes);
                const bool improves_incumbent = best_selected.empty() ?
                    (selected.size() < static_cast<size_t>(incumbent_count) ||
                     (selected.size() == static_cast<size_t>(incumbent_count) && std::tie(time, distance) < std::tie(best_time, best_distance))) :
                    (selected.size() < static_cast<size_t>(best_count) ||
                    (selected.size() == static_cast<size_t>(best_count) &&
                     std::tie(time, distance) < std::tie(best_time, best_distance)));
                if (within_limit && improves_incumbent) {
                    best_count = static_cast<int>(selected.size()); best_time = time; best_distance = distance;
                    best_selected = selected;
                }
                return;
            }
            if (selected.size() >= static_cast<size_t>(best_count)) return;
            int pivot = -1; size_t candidate_count = std::numeric_limits<size_t>::max();
            for (size_t request_pos = 0; request_pos < requests.size(); ++request_pos) {
                if (covered[request_pos]) continue;
                size_t feasible = 0;
                for (int ri : covering[request_pos]) {
                    const int team_index = route_team_index[ri];
                    if (team_index < 0 || team_used[team_index]) continue;
                    bool overlap = false;
                    for (int id : route_pool[ri].request_ids) if (covered[request_index.at(id)]) { overlap = true; break; }
                    if (!overlap) ++feasible;
                }
                if (feasible < candidate_count) { candidate_count = feasible; pivot = static_cast<int>(request_pos); }
                if (feasible == 0) return;
            }
            for (int ri : covering[pivot]) {
                if (expired()) return;
                const int team_index = route_team_index[ri];
                if (team_index < 0 || team_used[team_index]) continue;
                bool overlap = false;
                for (int id : route_pool[ri].request_ids) if (covered[request_index.at(id)]) { overlap = true; break; }
                if (overlap) continue;
                team_used[team_index] = 1;
                std::vector<int> changed;
                for (int id : route_pool[ri].request_ids) {
                    int pos = request_index.at(id); covered[pos] = 1; changed.push_back(pos); ++covered_count;
                }
                selected.push_back(ri); search(); selected.pop_back();
                for (int pos : changed) { covered[pos] = 0; --covered_count; }
                team_used[team_index] = 0;
            }
        };
        search();
        if (best_selected.empty()) return best;
        recombined_routes = initial_routes();
        for (int ri : best_selected) {
            const int team_index = route_team_index[ri];
            recombined_routes[team_index] = route_pool[ri];
        }
        Solution recombined = make_solution(recombined_routes, unassigned, request_map);
        if (!recombined.valid || !objective_better(recombined.objective, best.objective)) return best;
        routes = std::move(recombined_routes);
        best = std::move(recombined);
        if (config.use_vnd && !expired()) best = vnd(routes, unassigned, best);
        return best;
    }

    Solution minimize_teams(std::vector<Route>& routes, const std::vector<int>& unassigned, Solution best) {
        if (!unassigned.empty()) return best;
        while (!expired() && best.objective.used_teams > 1) {
            const int target = best.objective.used_teams - 1;
            const int previous_count = best.objective.used_teams;
            bool reduced = false;
            if (config.use_route_pool && !expired()) {
                Solution candidate = recombine_routes(routes, unassigned, best, target);
                if (candidate.objective.used_teams < previous_count) {
                    best = std::move(candidate); reduced = true;
                }
            }
            if (!reduced) {
                std::vector<int> candidates;
                for (size_t i = 0; i < routes.size(); ++i) if (!routes[i].request_ids.empty()) candidates.push_back(static_cast<int>(i));
                std::sort(candidates.begin(), candidates.end(), [&](int a, int b) {
                    return std::make_tuple(routes[a].request_ids.size(), a) < std::make_tuple(routes[b].request_ids.size(), b);
                });
                for (int candidate_index : candidates) {
                    if (expired()) break;
                    std::vector<Route> backup = routes;
                    std::vector<int> pending = routes[candidate_index].request_ids;
                    routes[candidate_index].request_ids.clear(); routes[candidate_index].stops.clear();
                    routes[candidate_index].distance = 0.0; routes[candidate_index].travel_time = 0;
                    if (repair_route_requests(routes, pending, candidate_index) && pending.empty()) {
                        Solution candidate = make_solution(routes, unassigned, request_map);
                        if (candidate.objective.used_teams <= target && candidate.objective.used_teams < previous_count) {
                            best = std::move(candidate); reduced = true; break;
                        }
                    }
                    routes = std::move(backup);
                }
            }
            if (!reduced) break;
            add_to_route_pool(routes);
            if (config.use_vnd && !expired()) best = vnd(routes, unassigned, best);
        }
        return best;
    }

    bool regret_repair(std::vector<Route>& routes, std::vector<int>& pending, int excluded_team = -1) {
        while (!pending.empty() && !expired()) {
            struct Choice { int id{}; std::vector<Insertion> options; int regret{}; int eligible{}; int width{}; int priority{}; };
            std::vector<Choice> choices;
            for (int id : pending) {
                const auto& request = request_map.at(id);
                auto options = insertions(request, routes, excluded_team);
                if (options.empty()) continue;
                std::sort(options.begin(), options.end(), [](const Insertion& a, const Insertion& b) {
                    return std::tie(a.delta_time, a.delta_distance, a.team_index, a.position) <
                           std::tie(b.delta_time, b.delta_distance, b.team_index, b.position);
                });
                const int best_delta = options.front().delta_time;
                int regret = 0;
                for (size_t i = 1; i < std::min<size_t>(3, options.size()); ++i) regret += options[i].delta_time - best_delta;
                std::set<int> eligible_team_indices;
                for (const auto& option : options) eligible_team_indices.insert(option.team_index);
                choices.push_back({id, std::move(options), regret, static_cast<int>(eligible_team_indices.size()),
                                   request.window_end - request.window_start,
                                   request.work_type == "EMERGENCY" ? 3 : request.work_type == "CONNECTION" ? 2 : 1});
            }
            if (choices.empty()) return false;
            auto chosen = std::min_element(choices.begin(), choices.end(), [](const Choice& a, const Choice& b) {
                return std::tuple(-a.priority, a.eligible, a.width, -a.regret, a.id) <
                       std::tuple(-b.priority, b.eligible, b.width, -b.regret, b.id);
            });
            const auto& insertion = chosen->options.front();
            apply_insertion(routes[insertion.team_index], insertion);
            if (!refresh(routes[insertion.team_index], insertion.team_index)) return false;
            pending.erase(std::find(pending.begin(), pending.end(), chosen->id));
        }
        return pending.empty();
    }

    std::vector<int> active_route_indices(const std::vector<Route>& routes) const {
        std::vector<int> result;
        for (size_t i = 0; i < routes.size(); ++i) if (!routes[i].request_ids.empty()) result.push_back(static_cast<int>(i));
        return result;
    }

    std::vector<int> destroy_route_removal(std::vector<Route>& routes, std::mt19937& rng) {
        auto active = active_route_indices(routes);
        if (active.empty()) return {};
        std::sort(active.begin(), active.end(), [&](int a, int b) {
            return std::make_tuple(routes[a].request_ids.size(), a) < std::make_tuple(routes[b].request_ids.size(), b);
        });
        const size_t candidate_count = std::min<size_t>(3, active.size());
        std::uniform_int_distribution<size_t> pick(0, candidate_count - 1);
        const int route_index = active[pick(rng)];
        std::vector<int> removed = routes[route_index].request_ids;
        routes[route_index].request_ids.clear(); routes[route_index].stops.clear(); routes[route_index].distance = 0.0; routes[route_index].travel_time = 0;
        return removed;
    }

    std::vector<int> destroy_worst_removal(std::vector<Route>& routes, std::mt19937& rng) {
        std::vector<int> all;
        for (const auto& route : routes) all.insert(all.end(), route.request_ids.begin(), route.request_ids.end());
        if (all.empty()) return {};
        const size_t count = std::min<size_t>(std::max<size_t>(1, all.size() / 10), 8);
        std::vector<std::pair<double, int>> scored;
        for (int id : all) {
            double score = 0.0;
            for (size_t ti = 0; ti < routes.size(); ++ti) {
                auto it = std::find(routes[ti].request_ids.begin(), routes[ti].request_ids.end(), id);
                if (it == routes[ti].request_ids.end()) continue;
                const size_t position = static_cast<size_t>(it - routes[ti].request_ids.begin());
                const auto old = routes[ti].request_ids;
                std::vector<int> reduced = old;
                reduced.erase(reduced.begin() + static_cast<long>(position));
                Schedule old_schedule = schedule_route(teams[ti], old);
                Schedule new_schedule = schedule_route(teams[ti], reduced);
                if (old_schedule.valid && new_schedule.valid) score = (old_schedule.travel_time - new_schedule.travel_time) +
                                                                          10.0 * (old_schedule.distance - new_schedule.distance);
                break;
            }
            scored.emplace_back(score, id);
        }
        std::sort(scored.begin(), scored.end(), [](const auto& a, const auto& b) { return std::tie(a.first, a.second) > std::tie(b.first, b.second); });
        std::vector<int> removed;
        for (size_t i = 0; i < count; ++i) {
            const int id = scored[i].second; removed.push_back(id);
            for (auto& route : routes) {
                auto it = std::find(route.request_ids.begin(), route.request_ids.end(), id);
                if (it != route.request_ids.end()) { route.request_ids.erase(it); break; }
            }
        }
        for (size_t ti = 0; ti < routes.size(); ++ti) if (!refresh(routes[ti], static_cast<int>(ti))) return {};
        std::shuffle(removed.begin(), removed.end(), rng);
        return removed;
    }

    std::vector<int> destroy_related_removal(std::vector<Route>& routes, std::mt19937& rng) {
        std::vector<int> all;
        for (const auto& route : routes) all.insert(all.end(), route.request_ids.begin(), route.request_ids.end());
        if (all.empty()) return {};
        std::uniform_int_distribution<size_t> seed_pick(0, all.size() - 1);
        const Request& seed = request_map.at(all[seed_pick(rng)]);
        const size_t count = std::min<size_t>(std::max<size_t>(1, all.size() / 10), 8);
        std::vector<std::pair<double, int>> related;
        for (int id : all) {
            const Request& request = request_map.at(id);
            const double geo = haversine(seed.lat, seed.lon, request.lat, request.lon);
            const double window = std::abs(seed.window_start - request.window_start) + std::abs(seed.window_end - request.window_end);
            related.emplace_back(geo + 0.01 * window, id);
        }
        std::sort(related.begin(), related.end());
        std::vector<int> removed;
        for (size_t i = 0; i < count; ++i) {
            const int id = related[i].second; removed.push_back(id);
            for (auto& route : routes) {
                auto it = std::find(route.request_ids.begin(), route.request_ids.end(), id);
                if (it != route.request_ids.end()) { route.request_ids.erase(it); break; }
            }
        }
        for (size_t ti = 0; ti < routes.size(); ++ti) if (!refresh(routes[ti], static_cast<int>(ti))) return {};
        return removed;
    }

    Solution alns(std::vector<Route>& routes, const std::vector<int>& unassigned, Solution best, unsigned seed) {
        if (!unassigned.empty()) return best;
        std::mt19937 rng(seed);
        std::array<double, 4> weights{0.45, 0.20, 0.20, config.use_exact_neighborhood ? 0.15 : 0.0};
        const int iterations = config.iteration_limit > 0 ? (config.iteration_limit + config.multi_start-1) / config.multi_start : 1000;
        for (int iteration = 0; iteration < iterations && !expired(); ++iteration) {
            count("alns_iterations");
            if (iteration % 32 == 0) restore_solution(routes, best);
            std::vector<Route> backup = routes;
            std::vector<int> removed;
            std::discrete_distribution<int> operator_pick(weights.begin(), weights.end());
            const int operator_index = operator_pick(rng);
            if (operator_index == 3) {
                const int previous_phase_limit = phase_time_limit_ms;
                phase_time_limit_ms = exact_phase_deadline_ms();
                Solution candidate = exact_neighborhood(routes, unassigned, best, rng);
                phase_time_limit_ms = previous_phase_limit;
                const bool improved = candidate.valid && objective_better(candidate.objective, best.objective);
                weights[operator_index] = 0.80 * weights[operator_index] + 0.20 * (improved ? 3.0 : 0.5);
                if (improved) best = std::move(candidate);
                else routes = std::move(backup);
                continue;
            }
            int excluded_team = -1;
            if (operator_index == 0) {
                removed = destroy_route_removal(routes, rng);
                for (size_t ti = 0; ti < routes.size(); ++ti)
                    if (!backup[ti].request_ids.empty() && routes[ti].request_ids.empty()) excluded_team = static_cast<int>(ti);
            }
            else if (operator_index == 1) removed = destroy_worst_removal(routes, rng);
            else removed = destroy_related_removal(routes, rng);
            if (removed.empty()) { routes = std::move(backup); break; }
            if (!repair_route_requests(routes, removed, excluded_team)) {
                weights[operator_index] = 0.80 * weights[operator_index] + 0.20 * 0.1;
                routes = std::move(backup); continue;
            }
            add_to_route_pool(routes);
            Solution candidate = make_solution(routes, unassigned, request_map);
            if (config.use_vnd && !expired()) {
                const int previous_limit = phase_time_limit_ms;
                const int local_limit = static_cast<int>(std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now()-started).count()) + 40;
                if (config.iteration_limit == 0)
                    phase_time_limit_ms = previous_limit > 0 ? std::min(previous_limit, local_limit) : local_limit;
                candidate = vnd(routes, unassigned, candidate);
                phase_time_limit_ms = previous_limit;
            }
            if (config.use_route_elimination && !expired()) candidate = eliminate_routes(routes, unassigned, candidate);
            add_to_route_pool(routes);
            const bool improved = candidate.valid && objective_better(candidate.objective, best.objective);
            weights[operator_index] = 0.80 * weights[operator_index] + 0.20 * (improved ? 3.0 : 0.5);
            if (improved) { best = std::move(candidate); count("alns_improvements"); }
            else {
                const auto current = evaluate_objective(backup, unassigned, request_map);
                const double temperature = std::max(1.0, best.objective.travel_time * 0.03 / (1.0 + iteration / 32.0));
                const double delta = candidate.objective.travel_time - current.travel_time;
                const bool explore = candidate.objective.used_teams <= best.objective.used_teams &&
                    (delta <= 0 || std::generate_canonical<double, 32>(rng) < std::exp(-delta / temperature));
                if (explore) count("alns_exploration_accepts");
                else routes = std::move(backup);
            }
        }
        restore_solution(routes, best);
        return best;
    }
};

Request request_from_dict(const py::dict& d) {
    Request r; r.id = d["id"].cast<int>(); r.lat = d["lat"].cast<double>(); r.lon = d["lon"].cast<double>();
    r.window_start = d["window_start"].cast<int>(); r.window_end = d["window_end"].cast<int>(); r.service_duration = d["service_duration"].cast<int>();
    r.release_time = d.contains("release_time") ? d["release_time"].cast<int>() : 0;
    r.required_skills = d["required_skills"].cast<int>();
    r.required_equipment = d.contains("required_equipment") ? d["required_equipment"].cast<std::vector<std::string>>() : std::vector<std::string>{};
    r.transport = d.contains("required_transport") ? d["required_transport"].cast<std::string>() : "";
    r.work_type = d.contains("work_type") ? d["work_type"].cast<std::string>() : "REPAIR";
    r.region_id = d.contains("region_id") ? d["region_id"].cast<std::string>() : "";
    return r;
}
Team team_from_dict(const py::dict& d) {
    Team t; t.id = d["id"].cast<int>(); t.start_lat = d["start_lat"].cast<double>(); t.start_lon = d["start_lon"].cast<double>();
    t.shift_start = d["shift_start"].cast<int>(); t.shift_end = d["shift_end"].cast<int>(); t.skills = d["skills"].cast<int>();
    if (d.contains("available_from")) t.shift_start = std::max(t.shift_start, d["available_from"].cast<int>());
    t.equipment = d.contains("equipment") ? d["equipment"].cast<std::vector<std::string>>() : std::vector<std::string>{};
    t.transport = d["transport"].cast<std::string>();
    t.available = d.contains("available") ? d["available"].cast<bool>() : true;
    t.region_id = d.contains("region_id") ? d["region_id"].cast<std::string>() : "";
    return t;
}

SolverConfig config_from_dict(const py::dict& values) {
    SolverConfig config;
    if (values.contains("time_limit_ms")) config.time_limit_ms = values["time_limit_ms"].cast<int>();
    if (values.contains("seed")) config.seed = values["seed"].cast<unsigned>();
    if (values.contains("use_vnd")) config.use_vnd = values["use_vnd"].cast<bool>();
    if (values.contains("use_alns")) config.use_alns = values["use_alns"].cast<bool>();
    if (values.contains("use_ejection")) config.use_ejection = values["use_ejection"].cast<bool>();
    if (values.contains("use_beam")) config.use_beam = values["use_beam"].cast<bool>();
    if (values.contains("use_route_pool")) config.use_route_pool = values["use_route_pool"].cast<bool>();
    if (values.contains("use_team_minimization")) config.use_team_minimization = values["use_team_minimization"].cast<bool>();
    if (values.contains("multi_start")) config.multi_start = values["multi_start"].cast<int>();
    if (values.contains("iteration_limit")) config.iteration_limit = values["iteration_limit"].cast<int>();
    if (values.contains("use_route_elimination")) config.use_route_elimination = values["use_route_elimination"].cast<bool>();
    if (values.contains("use_exact_neighborhood")) config.use_exact_neighborhood = values["use_exact_neighborhood"].cast<bool>();
    if (values.contains("exact_neighborhood_max_routes")) config.exact_neighborhood_max_routes = values["exact_neighborhood_max_routes"].cast<int>();
    if (values.contains("exact_neighborhood_node_limit")) config.exact_neighborhood_node_limit = values["exact_neighborhood_node_limit"].cast<int>();
    if (values.contains("exact_neighborhood_ejection_depth")) config.exact_neighborhood_ejection_depth = values["exact_neighborhood_ejection_depth"].cast<int>();
    if (config.time_limit_ms < 0) throw std::invalid_argument("time_limit_ms must be non-negative");
    if (config.multi_start < 1) throw std::invalid_argument("multi_start must be at least 1");
    if (config.iteration_limit < 0) throw std::invalid_argument("iteration_limit must be non-negative");
    if (config.exact_neighborhood_max_routes < 3 || config.exact_neighborhood_max_routes > 6) throw std::invalid_argument("exact_neighborhood_max_routes must be between 3 and 6");
    if (config.exact_neighborhood_node_limit < 1) throw std::invalid_argument("exact_neighborhood_node_limit must be positive");
    if (config.exact_neighborhood_ejection_depth < 0 || config.exact_neighborhood_ejection_depth > 4) throw std::invalid_argument("exact_neighborhood_ejection_depth must be between 0 and 4");
    return config;
}

py::dict solve_impl(const py::list& request_list, const py::list& team_list, const SolverConfig& config, py::object warm_start) {
    const auto input_started = Clock::now();
    Solver solver; solver.config = config;
    for (const auto& item : request_list) solver.requests.push_back(request_from_dict(item.cast<py::dict>()));
    for (const auto& item : team_list) solver.teams.push_back(team_from_dict(item.cast<py::dict>()));
    std::vector<Route> native_warm_start;
    if (!warm_start.is_none()) for (const auto& item : warm_start.cast<py::list>()) {
        const py::dict data = item.cast<py::dict>();
        Route route; route.team_id = data["team_id"].cast<int>();
        route.request_ids = data["request_ids"].cast<std::vector<int>>();
        native_warm_start.push_back(std::move(route));
    }
    const double input_preparation_ms = std::chrono::duration<double, std::milli>(Clock::now() - input_started).count();
    const auto execution_started = Clock::now();
    Solution result;
    { py::gil_scoped_release release; result = solver.solve(native_warm_start); }
    const double cpp_execution_ms = std::chrono::duration<double, std::milli>(Clock::now() - execution_started).count();
    solver.phase_timings_ms["cpp_execution"] = cpp_execution_ms;
    for (const char* phase : {"regret3", "vnd", "route_elimination", "alns", "ejection_beam", "route_pool", "team_minimization", "exact_neighborhood"}) {
        if (!solver.phase_timings_ms.contains(phase)) solver.phase_timings_ms[phase] = 0.0;
    }
    py::dict output; output["timed_out"] = solver.timed_out; output["best_valid_solution"] = result.valid;
    output["input_preparation_ms"] = input_preparation_ms;
    output["cpp_execution_ms"] = cpp_execution_ms;
    py::dict phase_timings;
    phase_timings["input_preparation"] = input_preparation_ms;
    for (const auto& item : solver.phase_timings_ms) phase_timings[item.first.c_str()] = item.second;
    output["phase_timings_ms"] = phase_timings;
    py::dict profile_counters;
    for (const auto& item : solver.profile_counters) profile_counters[item.first.c_str()] = item.second;
    output["profile_counters"] = profile_counters;
    output["route_pool_size"] = static_cast<int>(solver.route_pool.size());
    py::dict objective; objective["unassigned_emergency"] = result.objective.unassigned_emergency; objective["unassigned_connection"] = result.objective.unassigned_connection; objective["unassigned_other"] = result.objective.unassigned_other; objective["used_teams"] = result.objective.used_teams; objective["travel_time"] = result.objective.travel_time; objective["distance"] = result.objective.distance; output["objective"] = objective;
    py::list unassigned; for (int id : result.unassigned) unassigned.append(id); output["unassigned"] = unassigned; output["seed"] = config.seed;
    py::list route_list; for (const auto& route : result.routes) { py::dict r; r["team_id"] = route.team_id; py::list ids; for (int id : route.request_ids) ids.append(id); r["request_ids"] = ids; r["distance_km"] = route.distance; r["travel_time_minutes"] = route.travel_time; py::list stops; for (const auto& stop : route.stops) { py::dict s; s["request_id"] = stop.request_id; s["arrival"] = stop.arrival; s["start"] = stop.start; s["finish"] = stop.finish; s["travel_minutes"] = stop.travel_time; s["waiting_minutes"] = stop.waiting; s["distance_km"] = stop.distance; stops.append(s); } r["stops"] = stops; route_list.append(r); } output["routes"] = route_list; return output;
}

py::dict solve_config_binding(const py::list& request_list, const py::list& team_list, const py::dict& config, py::object warm_start) {
    return solve_impl(request_list, team_list, config_from_dict(config), warm_start);
}

py::dict solve_binding(const py::list& request_list, const py::list& team_list, int time_limit_ms, bool use_vnd, bool use_route_elimination, bool use_alns, bool use_ejection, bool use_beam, int multi_start, bool use_route_pool, bool use_team_minimization, py::object warm_start) {
    SolverConfig config;
    config.time_limit_ms = time_limit_ms; config.use_vnd = use_vnd; config.use_route_elimination = use_route_elimination;
    config.use_alns = use_alns; config.use_ejection = use_ejection; config.use_beam = use_beam;
    config.multi_start = multi_start; config.use_route_pool = use_route_pool; config.use_team_minimization = use_team_minimization;
    return solve_impl(request_list, team_list, config, warm_start);
}
}

PYBIND11_MODULE(cpp_solver, module) { module.doc() = "C++20 Regret-3 + VND + Route Elimination + ALNS + Route Pool optimization core"; module.def("solve", &solve_binding, py::arg("requests"), py::arg("teams"), py::arg("time_limit_ms"), py::arg("use_vnd") = true, py::arg("use_route_elimination") = false, py::arg("use_alns") = false, py::arg("use_ejection") = false, py::arg("use_beam") = false, py::arg("multi_start") = 1, py::arg("use_route_pool") = false, py::arg("use_team_minimization") = false, py::arg("warm_start") = py::none()); module.def("solve_config", &solve_config_binding, py::arg("requests"), py::arg("teams"), py::arg("config"), py::arg("warm_start") = py::none()); }
