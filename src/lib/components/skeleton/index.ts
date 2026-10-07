import Skeleton from "./skeleton.svelte";
import ProblemSkeleton, {
    type ProblemSkeletonProps,
} from "./problem-skeleton.svelte";
import ListRowSkeleton, {
    type ListRowSkeletonProps,
} from "./list-row-skeleton.svelte";
import {
    skeletonVariants,
    type SkeletonProps,
    type SkeletonRounded,
} from "./skeleton.js";

export {
    Skeleton,
    Skeleton as Root,
    skeletonVariants,
    type SkeletonProps,
    type SkeletonProps as Props,
    type SkeletonRounded,
    ProblemSkeleton,
    type ProblemSkeletonProps,
    ListRowSkeleton,
    type ListRowSkeletonProps,
};

export default Skeleton;
