import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "$lib/types/database.types";

export type RoadmapGoalRow = Tables<"roadmap_goals">;
export type RoadmapVoteRow = Tables<"roadmap_votes">;

export interface RoadmapGoalWithVotes extends RoadmapGoalRow {
    roadmap_votes: RoadmapVoteRow[];
}

export type RoadmapStatus = "done" | "active" | "future";

/**
 * Fetches all roadmap goals with all their votes.
 */
export async function fetchRoadmap(
    supabase: SupabaseClient<Database>,
): Promise<RoadmapGoalWithVotes[]> {
    const { data, error } = await supabase
        .from("roadmap_goals")
        .select("*, roadmap_votes(*)")
        .order("created_at", { ascending: false });

    if (error) {
        throw error;
    }

    return (data ?? []) as RoadmapGoalWithVotes[];
}

/**
 * Upserts a vote for a goal by a user.
 */
export async function voteGoal(
    supabase: SupabaseClient<Database>,
    goalId: number,
    profileId: string,
    voteValue: 1 | -1,
): Promise<void> {
    const { error } = await supabase
        .from("roadmap_votes")
        .upsert({
            goal_id: goalId,
            profile_id: profileId,
            vote_value: voteValue,
        });

    if (error) {
        throw error;
    }
}

/**
 * Deletes a vote for a goal by a user.
 */
export async function unvoteGoal(
    supabase: SupabaseClient<Database>,
    goalId: number,
    profileId: string,
): Promise<void> {
    const { error } = await supabase
        .from("roadmap_votes")
        .delete()
        .eq("goal_id", goalId)
        .eq("profile_id", profileId);

    if (error) {
        throw error;
    }
}

/**
 * Creates a new roadmap goal (Admin only).
 */
export async function createGoal(
    supabase: SupabaseClient<Database>,
    goal: {
        title: string;
        description: string;
        status: RoadmapStatus;
        planned_date: string | null;
    },
): Promise<RoadmapGoalRow> {
    const { data, error } = await supabase
        .from("roadmap_goals")
        .insert({
            title: goal.title,
            description: goal.description,
            status: goal.status,
            planned_date: goal.planned_date || null,
        })
        .select()
        .single();

    if (error) {
        throw error;
    }

    return data;
}

/**
 * Updates an existing roadmap goal (Admin only).
 */
export async function updateGoal(
    supabase: SupabaseClient<Database>,
    id: number,
    goal: {
        title: string;
        description: string;
        status: RoadmapStatus;
        planned_date: string | null;
    },
): Promise<RoadmapGoalRow> {
    const { data, error } = await supabase
        .from("roadmap_goals")
        .update({
            title: goal.title,
            description: goal.description,
            status: goal.status,
            planned_date: goal.planned_date || null,
            updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();

    if (error) {
        throw error;
    }

    return data;
}

/**
 * Deletes a roadmap goal (Admin only).
 */
export async function deleteGoal(
    supabase: SupabaseClient<Database>,
    id: number,
): Promise<void> {
    const { error } = await supabase
        .from("roadmap_goals")
        .delete()
        .eq("id", id);

    if (error) {
        throw error;
    }
}
