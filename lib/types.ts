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

// The columns the app reads from `reviews`. The table also carries `source`
// ('site' | 'xlsx' | 'rmp') and `rmp_rating_id`, which only the maintenance
// scripts use; selecting by name keeps them out of every page payload.
export const REVIEW_COLUMNS =
  "id, course_id, user_id, quality, difficulty, instructor, hours_per_week, comment, created_at";

export interface ReviewFlag {
  id: number;
  review_id: number;
  user_id: string;
  reason: string;
  created_at: string;
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
