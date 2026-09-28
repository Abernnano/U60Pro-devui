/* Fixed-action Mihomo controller. No commands or paths supplied by HTML.
 * The worker execs separately so it survives screen restarts, holds an OS lock,
 * and bounds output in RAM rather than growing temporary files indefinitely.
 * SPDX-License-Identifier: MIT */
#ifndef DEVUI_MIHOMO_CONTROL_H
#define DEVUI_MIHOMO_CONTROL_H
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <spawn.h>
#include <sys/file.h>
#include <sys/wait.h>
#ifndef MH_LOCK
#define MH_LOCK "/tmp/devui-mihomo-action.lock"
#endif
static pid_t g_mh_worker;
extern char **environ;
static int mh_lock_open(void) { return open(MH_LOCK,O_RDWR|O_CREAT|O_CLOEXEC|O_NOFOLLOW,0600); }
static int mh_busy(void)
{
    int fd=mh_lock_open(),busy;
    if (fd<0) return 1; /* fail closed, never overlap actions on lock errors */
    busy=flock(fd,LOCK_EX|LOCK_NB)!=0;
    close(fd);return busy || g_mh_worker>0;
}
static void mh_reap(void)
{
    if (g_mh_worker>0 && waitpid(g_mh_worker,NULL,WNOHANG)==g_mh_worker) g_mh_worker=0;
}
static int mh_supports(const char *path,const char *verb)
{
    FILE *fp=fopen(path,"r");char line[512];int found=0;
    if (!fp) return 0;
    while (fgets(line,sizeof line,fp)) {
        char *p=line,*end,*part,*save;
        while (isspace((unsigned char)*p)) p++;
        if (*p=='#' || !(end=strchr(p,')')) || (strchr(p,'#') && strchr(p,'#')<end)) continue;
        *end=0;
        for (part=strtok_r(p,"|",&save);part;part=strtok_r(NULL,"|",&save)) {
            while (isspace((unsigned char)*part) || *part=='\'' || *part=='"' || *part=='(') part++;
            end=part+strlen(part);
            while (end>part && (isspace((unsigned char)end[-1]) || end[-1]=='\'' || end[-1]=='"')) *--end=0;
            if (!strcmp(part,verb)) {found=1;break;}
        }
        if (found) break;
    }
    fclose(fp);return found;
}
static void mh_tail_append(char *tail,size_t cap,const char *chunk,size_t n)
{
    size_t used=strlen(tail);
    if (n>=cap) {chunk+=n-(cap-1);n=cap-1;used=0;}
    else if (used+n>=cap) {size_t drop=used+n-(cap-1);memmove(tail,tail+drop,used-drop);used-=drop;}
    memcpy(tail+used,chunk,n);tail[used+n]=0;
}
static void mh_worker_log(const char *verb,const char *tail,const char *message,int rc)
{
    int fd=open(MIHOMO_ACTION_LOG,O_WRONLY|O_CREAT|O_TRUNC|O_CLOEXEC|O_NOFOLLOW,0600);
    FILE *fp=fd<0?NULL:fdopen(fd,"w");
    if (!fp) {if(fd>=0)close(fd);return;}
    fprintf(fp,"Mihomo %s\n%s%s%s (rc=%d)\n",verb,tail,tail[0]?"\n":"",message,rc);
    fclose(fp);
}
static int mh_control_worker(const char *verb)
{
    int lockfd,fd[2],status=0,rc=1;pid_t child;char tail[4096]="",buf[512],config[320];
    const struct plugin_candidate *p;
    if (strcmp(verb,"start") && strcmp(verb,"stop") && strcmp(verb,"restart")) return 64;
    lockfd=mh_lock_open();if(lockfd<0)return 73;
    if(flock(lockfd,LOCK_EX|LOCK_NB)!=0){close(lockfd);return 75;}
    p=plugin_script_select(g_mh_candidates,ARRAY_LEN(g_mh_candidates),strcmp(verb,"stop")!=0);
    if(!p){mh_worker_log(verb,"","插件核心或 mm.sh 缺失",1);goto done;}
    if(!mh_supports(p->ctl,verb)){mh_worker_log(verb,"","mm.sh 未声明此子命令；已拒绝执行",1);goto done;}
    snprintf(config,sizeof config,"%s/config.yaml",p->dir);
    if(strcmp(verb,"stop") && access(config,R_OK)!=0){mh_worker_log(verb,"","缺少 config.yaml，请先在代理插件配置",1);goto done;}
    mh_worker_log(verb,"","正在执行，完成前禁止重复提交",0);
    if(pipe2(fd,O_CLOEXEC)!=0){mh_worker_log(verb,"","无法建立输出通道",errno);goto done;}
    child=fork();
    if(child<0){close(fd[0]);close(fd[1]);mh_worker_log(verb,"","无法创建控制进程",errno);goto done;}
    if(child==0){
        close(fd[0]);close(lockfd);
        if(chdir(p->dir)!=0 || dup2(fd[1],STDOUT_FILENO)<0 || dup2(fd[1],STDERR_FILENO)<0)_exit(126);
        close(fd[1]);execl("/bin/sh","sh",p->ctl,verb,(char *)NULL);_exit(127);
    }
    close(fd[1]);fcntl(fd[0],F_SETFL,fcntl(fd[0],F_GETFL)|O_NONBLOCK);
    for(;;){
        struct pollfd pollfd={fd[0],POLLIN,0};pid_t ended;
        (void)poll(&pollfd,1,200);
        /* Bound each drain pass too: an endlessly chatty command must not
         * prevent waitpid from noticing that mm.sh already finished. */
        for(int i=0;i<32;i++){ssize_t n=read(fd[0],buf,sizeof buf);if(n<=0)break;
            for(ssize_t j=0;j<n;j++)if(!buf[j])buf[j]='?';
            mh_tail_append(tail,sizeof tail,buf,(size_t)n);}
        ended=waitpid(child,&status,WNOHANG);
        if(ended==child)break;
        if(ended<0 && errno!=EINTR){status=1<<8;break;}
        if(pollfd.revents&POLLHUP)usleep(100000); /* quiet but still running */
    }
    for(int i=0;i<128;i++){ssize_t n=read(fd[0],buf,sizeof buf);if(n<=0)break;
        for(ssize_t j=0;j<n;j++)if(!buf[j])buf[j]='?';
        mh_tail_append(tail,sizeof tail,buf,(size_t)n);}
    close(fd[0]);rc=WIFEXITED(status)?WEXITSTATUS(status):128+(WIFSIGNALED(status)?WTERMSIG(status):0);
    mh_worker_log(verb,tail,rc?"操作失败，请检查输出":"命令执行完成，请以重新检测的链路状态为准",rc);
 done:
    close(lockfd);return rc;
}
static int mh_submit(const char *verb)
{
    posix_spawn_file_actions_t fa;pid_t pid;int rc;
    char *args[]={"u60pro-devui","--mihomo-control",(char *)verb,NULL};
    mh_reap();if(mh_busy())return EBUSY;
    if((rc=posix_spawn_file_actions_init(&fa)))return rc;
    rc=posix_spawn_file_actions_addopen(&fa,0,"/dev/null",O_RDONLY,0);
    if(!rc)rc=posix_spawn_file_actions_addopen(&fa,1,"/dev/null",O_WRONLY,0);
    if(!rc)rc=posix_spawn_file_actions_adddup2(&fa,1,2);
    if(!rc)rc=posix_spawn(&pid,"/proc/self/exe",&fa,NULL,args,environ);
    posix_spawn_file_actions_destroy(&fa);
    if(!rc)g_mh_worker=pid;
    return rc;
}
/* Read-only diagnostics get a real deadline. Never use this timeout helper
 * for start/stop: killing mm.sh mid-firewall-update can strand the network. */
static int mh_capture(const char *cmd,char *out,size_t cap,int timeout_ms)
{
    int fd[2],rc,status=0,exited=0;size_t used=0;pid_t pid;
    struct timespec ts;long long end;
    posix_spawn_file_actions_t fa;posix_spawnattr_t attr;
    char *args[]={"sh","-c",(char *)cmd,NULL};
    if(!cap)return 0;out[0]=0;if(pipe2(fd,O_CLOEXEC)!=0)return 0;
    posix_spawn_file_actions_init(&fa);posix_spawnattr_init(&attr);
    posix_spawn_file_actions_adddup2(&fa,fd[1],1);
    posix_spawn_file_actions_addopen(&fa,2,"/dev/null",O_WRONLY,0);
    posix_spawn_file_actions_addclose(&fa,fd[0]);posix_spawn_file_actions_addclose(&fa,fd[1]);
    posix_spawnattr_setflags(&attr,POSIX_SPAWN_SETPGROUP);posix_spawnattr_setpgroup(&attr,0);
    rc=posix_spawn(&pid,"/bin/sh",&fa,&attr,args,environ);
    posix_spawn_file_actions_destroy(&fa);posix_spawnattr_destroy(&attr);close(fd[1]);
    if(rc){close(fd[0]);return 0;}
    fcntl(fd[0],F_SETFL,fcntl(fd[0],F_GETFL)|O_NONBLOCK);
    clock_gettime(CLOCK_MONOTONIC,&ts);end=ts.tv_sec*1000LL+ts.tv_nsec/1000000+timeout_ms;
    for(;;){
        char discard[256];struct pollfd pfd={fd[0],POLLIN,0};
        for(int i=0;i<32;i++){
            ssize_t n=used<cap-1?read(fd[0],out+used,cap-1-used):read(fd[0],discard,sizeof discard);
            if(n<=0)break;if(used<cap-1)used+=(size_t)n;
        }
        if(waitpid(pid,&status,WNOHANG)==pid){exited=1;break;}
        clock_gettime(CLOCK_MONOTONIC,&ts);if(ts.tv_sec*1000LL+ts.tv_nsec/1000000>=end)break;
        (void)poll(&pfd,1,25);
    }
    /* One last bounded drain after shell exit; descendants may still hold the
     * pipe, so EOF is deliberately not required. */
    if(exited && used<cap-1){ssize_t n=read(fd[0],out+used,cap-1-used);if(n>0)used+=(size_t)n;}
    if(!exited){kill(-pid,SIGKILL);while(waitpid(pid,&status,0)<0 && errno==EINTR){}}
    close(fd[0]);out[used]=0;return exited && WIFEXITED(status) && WEXITSTATUS(status)==0;
}
#endif
