/* Download a complete data set into a private same-filesystem staging directory.
 * Never execute downloaded content. TLS verification stays enabled. */
#ifndef DEVUI_MIHOMO_DATA_H
#define DEVUI_MIHOMO_DATA_H
static const char *mx_files[]={"chnroute.txt","chnroute6.txt","GeoSite.dat","geoip.metadb","data_version.txt"};
static const char *mx_sources[]={
 "https://github.com/Jack-bin183/WebSSH-u60pro/releases/download/latest-data/",
 "https://github.com/Zhengjian12345/backup-files/releases/download/backup/"};
static int mx_varint(FILE *fp,unsigned long long *value)
{*value=0;for(int i=0;i<10;i++){int c=fgetc(fp);if(c==EOF||(i==9&&(c&254)))return 0;*value|=(unsigned long long)(c&127)<<(i*7);if(!(c&128))return 1;}return 0;}
static int mx_validate_file(const char *path,int index)
{
    struct stat st;if(lstat(path,&st)||!S_ISREG(st.st_mode)||st.st_size<(index==4?1:100)||st.st_size>64*1024*1024)return 0;
    FILE *fp=fopen(path,"rb");if(!fp)return 0;int ok=1,count=0;
    if(index<2){char line[512];unsigned char addr[16];while(fgets(line,sizeof line,fp)){char *p=(char *)mx_ws(line),*end;if(!strchr(line,'\n')&&!feof(fp)){ok=0;break;}
        if(!*p||*p=='#')continue;end=p+strlen(p);while(end>p&&isspace((unsigned char)end[-1]))*--end=0;
        char *slash=strchr(p,'/');if(!slash){ok=0;break;}*slash++=0;char *last;long prefix=strtol(slash,&last,10);
        if(!isdigit((unsigned char)*slash)||*last||prefix<0||prefix>(index?128:32)||inet_pton(index?AF_INET6:AF_INET,p,addr)!=1){ok=0;break;}count++;}ok=ok&&count>0&&!ferror(fp);
    }else if(index==2){/* GeoSiteList: repeated field 1, length-delimited protobuf. */
        while(ftell(fp)<st.st_size){unsigned long long key,len;if(!mx_varint(fp,&key)||key!=10||!mx_varint(fp,&len)||!len||len>(unsigned long long)(st.st_size-ftell(fp))){ok=0;break;}
            if(fseek(fp,(long)len,SEEK_CUR)){ok=0;break;}count++;}ok=ok&&count>0&&ftell(fp)==st.st_size;
    }else if(index==3){/* MaxMind-compatible MetaDB metadata marker must be near EOF. */
        unsigned char tail[131072];long offset=st.st_size>(off_t)sizeof tail?st.st_size-(off_t)sizeof tail:0;
        if(fseek(fp,offset,SEEK_SET))ok=0;size_t n=fread(tail,1,sizeof tail,fp);const unsigned char magic[]={0xab,0xcd,0xef,'M','a','x','M','i','n','d','.','c','o','m'};
        ok=ok&&!ferror(fp)&&memmem(tail,n,magic,sizeof magic)!=NULL;
    }else{if(st.st_size>4096)ok=0;int c;while(ok&&(c=fgetc(fp))!=EOF)if((c<32&&c!='\n'&&c!='\r'&&c!='\t')||c=='<'||c=='>')ok=0;ok=ok&&!ferror(fp);}
    fclose(fp);return ok;
}
static int mx_update(const char *dir)
{
    char stage[512],src[640],dst[640],bak[640],url[1024];int ok=0,downloaded=0,committed=0,preserve=0;int existed[5]={0};
    snprintf(stage,sizeof stage,"%s/.devui-data-XXXXXX",dir);if(!mkdtemp(stage)){snprintf(mx_error,sizeof mx_error,"无法创建数据暂存目录，请检查权限和空间");return 0;}
    for(int mirror=0;mirror<2&&!downloaded;mirror++){
        downloaded=1;
        for(int i=0;i<5;i++){
            snprintf(src,sizeof src,"%s/%s",stage,mx_files[i]);snprintf(url,sizeof url,"%s%s",mx_sources[mirror],mx_files[i]);
            char progress[256];snprintf(progress,sizeof progress,"源 %d/2 · 下载并校验 %d/5：%s；未替换现有文件",mirror+1,i+1,mx_files[i]);mh_worker_log("数据更新","",progress,0);
            char *args[]={"curl","-q","--fail","--silent","--show-error","--location","--proto","=https","--proto-redir","=https","--connect-timeout","10","--max-time","90","--max-filesize","67108864","-o",src,"--url",url,NULL};
            if(!mx_run(args,95)||!mx_validate_file(src,i)){snprintf(mx_error,sizeof mx_error,"下载/校验失败：%s；保留全部旧文件",mx_files[i]);downloaded=0;break;}
            int fd=open(src,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);if(fd<0||fsync(fd)){if(fd>=0)close(fd);downloaded=0;snprintf(mx_error,sizeof mx_error,"数据落盘失败；保留全部旧文件");break;}close(fd);
        }
    }
    if(!downloaded)goto done;
    /* Hard-link backups leave the old pathname present until each atomic rename. */
    for(int i=0;i<5;i++){struct stat st;snprintf(dst,sizeof dst,"%s/%s",dir,mx_files[i]);snprintf(bak,sizeof bak,"%s/old-%d",stage,i);
        if(lstat(dst,&st)==0){if(!S_ISREG(st.st_mode)||link(dst,bak)){snprintf(mx_error,sizeof mx_error,"旧数据备份失败；拒绝覆盖");goto done;}existed[i]=1;}
        else if(errno!=ENOENT){snprintf(mx_error,sizeof mx_error,"无法检查旧数据；拒绝覆盖");goto done;}}
    for(int i=0;i<5;i++){snprintf(src,sizeof src,"%s/%s",stage,mx_files[i]);snprintf(dst,sizeof dst,"%s/%s",dir,mx_files[i]);
        if(rename(src,dst)){snprintf(mx_error,sizeof mx_error,"替换失败，已回滚旧文件");goto rollback;}committed++;}
    {int fd=open(dir,O_RDONLY|O_DIRECTORY|O_CLOEXEC);if(fd<0||fsync(fd)){if(fd>=0)close(fd);snprintf(mx_error,sizeof mx_error,"目录落盘失败，已回滚旧文件");goto rollback;}close(fd);}
    ok=1;snprintf(mx_error,sizeof mx_error,"4 个数据文件及版本文件均已更新；运行中规则未重载，请在网络可中断时重启代理生效");goto done;
 rollback:
    for(int i=committed-1;i>=0;i--){snprintf(dst,sizeof dst,"%s/%s",dir,mx_files[i]);snprintf(bak,sizeof bak,"%s/old-%d",stage,i);
        if(existed[i]?rename(bak,dst):unlink(dst)){preserve=1;snprintf(mx_error,sizeof mx_error,"回滚失败，请从插件目录 .devui-data-* 的 old-N 恢复；停止继续更新");}}
 done:
    if(!preserve){for(int i=0;i<5;i++){snprintf(src,sizeof src,"%s/%s",stage,mx_files[i]);unlink(src);snprintf(bak,sizeof bak,"%s/old-%d",stage,i);unlink(bak);}rmdir(stage);}return ok;
}
#endif
