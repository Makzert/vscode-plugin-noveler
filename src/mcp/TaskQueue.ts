export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface TaskRecord<TResult = unknown> {
    id: string;
    label?: string;
    status: TaskStatus;
    createdAt: number;
    startedAt?: number;
    finishedAt?: number;
    result?: TResult;
    error?: string;
}

export interface EnqueueTaskOptions {
    label?: string;
}

export type TaskListener = (task: TaskRecord) => void;

interface InternalTask<TResult> extends TaskRecord<TResult> {
    run: () => Promise<TResult>;
}

export class TaskQueue {
    private readonly queue: Array<InternalTask<unknown>> = [];
    private readonly records = new Map<string, TaskRecord<unknown>>();
    private readonly listeners = new Set<TaskListener>();
    private runningCount = 0;
    private idCounter = 0;

    public constructor(private readonly concurrency = 1) {}

    public enqueue<TResult>(
        run: () => Promise<TResult>,
        options?: EnqueueTaskOptions
    ): Promise<TaskRecord<TResult>> {
        const id = this.nextId();
        const task: InternalTask<TResult> = {
            id,
            label: options?.label,
            status: 'pending',
            createdAt: Date.now(),
            run
        };
        this.records.set(id, task);
        this.queue.push(task as InternalTask<unknown>);
        this.emit(task);
        this.drain();

        return this.waitForFinish<TResult>(id);
    }

    public getTask(id: string): TaskRecord | undefined {
        return this.records.get(id);
    }

    public listTasks(): TaskRecord[] {
        return Array.from(this.records.values()).sort((a, b) => b.createdAt - a.createdAt);
    }

    public onDidUpdateTask(listener: TaskListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private drain(): void {
        while (this.runningCount < Math.max(1, this.concurrency) && this.queue.length > 0) {
            const task = this.queue.shift();
            if (!task) {
                break;
            }

            this.runningCount++;
            task.status = 'running';
            task.startedAt = Date.now();
            this.emit(task);

            void task.run()
                .then((result) => {
                    task.status = 'completed';
                    task.result = result;
                })
                .catch((error) => {
                    task.status = 'failed';
                    task.error = error instanceof Error ? error.message : String(error);
                })
                .finally(() => {
                    task.finishedAt = Date.now();
                    this.runningCount--;
                    this.emit(task);
                    this.drain();
                });
        }
    }

    private async waitForFinish<TResult>(id: string): Promise<TaskRecord<TResult>> {
        const task = this.records.get(id);
        if (!task) {
            throw new Error(`Task not found: ${id}`);
        }
        if (task.status === 'completed' || task.status === 'failed') {
            return task as TaskRecord<TResult>;
        }

        return new Promise((resolve) => {
            const dispose = this.onDidUpdateTask((updated) => {
                if (updated.id !== id) {
                    return;
                }
                if (updated.status === 'completed' || updated.status === 'failed') {
                    dispose();
                    resolve(updated as TaskRecord<TResult>);
                }
            });
        });
    }

    private emit(task: TaskRecord): void {
        for (const listener of this.listeners) {
            listener(task);
        }
    }

    private nextId(): string {
        this.idCounter++;
        return `task-${Date.now()}-${this.idCounter}`;
    }
}
