export interface Course {
  id: number;
  code: string;
  name: string;
  departments: string[];
  instructors: string[];
  description: string;
  bulletin_code: string;
  last_offered: string;
  created_at: string;
}

export interface CourseWithStats extends Course {
  review_count: number;
  avg_quality: number | null;
  avg_difficulty: number | null;
}

export interface Review {
  id: number;
  course_id: number;
  user_id: string;
  quality: number;
  difficulty: number;
  instructor: string;
  hours_per_week: string;
  comment: string;
  created_at: string;
}

export interface ReviewFlag {
  id: number;
  review_id: number;
  user_id: string;
  reason: string;
  created_at: string;
}

export interface RmpInstructor {
  id: number;
  legacy_id: number;
  first_name: string;
  last_name: string;
  quality: number | null;
  difficulty: number | null;
  would_take_again: number | null;
  num_ratings: number;
  department: string;
  synced_at: string;
}

/** A professor as the search list shows them, after surnames have been folded
 *  into full names. Averages are review-count weighted across every stored
 *  spelling that resolved to this person. */
export interface InstructorSummary {
  name: string;
  review_count: number;
  course_count: number;
  avg_quality: number | null;
  avg_difficulty: number | null;
  /** The raw reviews.instructor values that folded into this entry. */
  aliases: string[];
}
